// Paystack Nigeria local-card fee model, used to gross-up wallet funding so the
// amount the user picks is exactly what lands in their wallet and they visibly
// cover the processing fee on top. All values in KOBO.
//
// Defaults match Paystack's published Nigeria pricing; override via env if it
// changes so we never have to redeploy for a fee tweak.
const RATE = Number(process.env.PAYSTACK_FEE_RATE ?? 0.015);                       // 1.5%
const FLAT_KOBO = Number(process.env.PAYSTACK_FEE_FLAT_KOBO ?? 10000);             // ₦100
const FLAT_WAIVER_BELOW_KOBO = Number(process.env.PAYSTACK_FEE_FLAT_WAIVER_BELOW_KOBO ?? 250000); // ₦2,500
const CAP_KOBO = Number(process.env.PAYSTACK_FEE_CAP_KOBO ?? 200000);              // ₦2,000

// Wallet funding bounds (kobo).
export const WALLET_FUNDING_MIN_KOBO = Number(process.env.WALLET_FUNDING_MIN_KOBO ?? 10000);       // ₦100
export const WALLET_FUNDING_MAX_KOBO = Number(process.env.WALLET_FUNDING_MAX_KOBO ?? 50000000);    // ₦500,000
export const WALLET_MAX_BALANCE_KOBO = Number(process.env.WALLET_MAX_BALANCE_KOBO ?? 100000000);   // ₦1,000,000

// The fee Paystack deducts from a gross charge.
export function paystackFee(chargeKobo) {
  const flat = chargeKobo >= FLAT_WAIVER_BELOW_KOBO ? FLAT_KOBO : 0;
  const fee = Math.ceil(RATE * chargeKobo) + flat;
  return Math.min(fee, CAP_KOBO);
}

// Given the amount the user wants IN their wallet, return what to charge so that
// after Paystack's cut we still net at least that amount. The user-facing fee is
// simply (charge - desired) — the extra they pay on top.
export function computeFunding(desiredKobo) {
  const solveWithFlat = (flat) => Math.ceil((desiredKobo + flat) / (1 - RATE));

  // Piecewise: try without the flat fee first; if the charge crosses the waiver
  // threshold, redo with the flat; then clamp for the fee cap.
  let charge = solveWithFlat(0);
  if (charge >= FLAT_WAIVER_BELOW_KOBO) {
    charge = solveWithFlat(FLAT_KOBO);
  }
  if (paystackFee(charge) >= CAP_KOBO) {
    charge = desiredKobo + CAP_KOBO;
  }
  // Guard integer rounding so Motoka never nets below the credited amount.
  while (charge - paystackFee(charge) < desiredKobo) charge += 1;

  return { desiredKobo, feeKobo: charge - desiredKobo, chargeKobo: charge };
}

// Validate a requested funding amount (the amount to land in the wallet).
export function validateFundingAmount(desiredKobo, currentBalanceKobo = 0) {
  if (!Number.isInteger(desiredKobo) || desiredKobo <= 0) {
    return { valid: false, error: 'Amount must be a positive whole number of kobo.' };
  }
  if (desiredKobo < WALLET_FUNDING_MIN_KOBO) {
    return { valid: false, error: `Minimum top-up is ₦${WALLET_FUNDING_MIN_KOBO / 100}.` };
  }
  if (desiredKobo > WALLET_FUNDING_MAX_KOBO) {
    return { valid: false, error: `Maximum single top-up is ₦${WALLET_FUNDING_MAX_KOBO / 100}.` };
  }
  if (currentBalanceKobo + desiredKobo > WALLET_MAX_BALANCE_KOBO) {
    return { valid: false, error: `This would exceed the maximum wallet balance of ₦${WALLET_MAX_BALANCE_KOBO / 100}.` };
  }
  return { valid: true };
}
