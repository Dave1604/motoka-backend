import { describe, it, expect } from '@jest/globals';
import {
  paystackFee,
  computeFunding,
  validateFundingAmount,
  WALLET_FUNDING_MIN_KOBO,
  WALLET_FUNDING_MAX_KOBO,
  WALLET_MAX_BALANCE_KOBO
} from '../utils/walletFee.js';

// Amounts in kobo. ₦X = X * 100.
describe('wallet funding fee gross-up', () => {
  const amounts = [10000, 200000, 250000, 500000, 1000000, 2000000, 5000000, 50000000];

  it('always nets Motoka at least the credited amount (user covers the fee)', () => {
    for (const desired of amounts) {
      const { chargeKobo } = computeFunding(desired);
      // After Paystack takes its cut of the gross charge, we must still have >= desired.
      expect(chargeKobo - paystackFee(chargeKobo)).toBeGreaterThanOrEqual(desired);
    }
  });

  it('reports fee as the exact extra the user pays on top', () => {
    for (const desired of amounts) {
      const { feeKobo, chargeKobo } = computeFunding(desired);
      expect(feeKobo).toBe(chargeKobo - desired);
      expect(feeKobo).toBeGreaterThan(0);
    }
  });

  it('waives the flat fee below the ₦2,500 threshold (cheaper small top-ups)', () => {
    // ₦1,000 charge is under threshold → fee is percentage only, no ₦100 flat.
    expect(paystackFee(100000)).toBe(Math.ceil(0.015 * 100000)); // 1500, no +10000 flat
    // ₦3,000 charge is over threshold → includes the flat.
    expect(paystackFee(300000)).toBe(Math.ceil(0.015 * 300000) + 10000);
  });

  it('caps the fee (large top-ups pay the flat ₦2,000 cap, not more)', () => {
    const { feeKobo } = computeFunding(50000000); // ₦500,000
    expect(feeKobo).toBeLessThanOrEqual(200000 + 100); // cap + rounding slack
  });

  it('makes the fee percentage shrink as the top-up grows, above the flat-fee threshold', () => {
    // Above ₦2,500 the flat ₦100 applies and amortizes as the amount grows, so
    // bigger top-ups are cheaper in %. (Below ₦2,500 the flat is waived, so the
    // curve is non-monotonic across that boundary — hence both samples here are
    // comfortably above it, matching the preset top-up chips ₦5k/₦10k/₦20k.)
    const small = computeFunding(500000);    // ₦5,000
    const large = computeFunding(5000000);   // ₦50,000
    const pct = (q) => q.feeKobo / q.desiredKobo;
    expect(pct(large)).toBeLessThan(pct(small));
  });
});

describe('validateFundingAmount', () => {
  it('rejects below minimum', () => {
    expect(validateFundingAmount(WALLET_FUNDING_MIN_KOBO - 1).valid).toBe(false);
  });
  it('rejects above per-top-up maximum', () => {
    expect(validateFundingAmount(WALLET_FUNDING_MAX_KOBO + 1).valid).toBe(false);
  });
  it('rejects when it would exceed the max wallet balance', () => {
    const res = validateFundingAmount(WALLET_FUNDING_MIN_KOBO, WALLET_MAX_BALANCE_KOBO);
    expect(res.valid).toBe(false);
  });
  it('accepts a valid amount', () => {
    expect(validateFundingAmount(500000, 0).valid).toBe(true);
  });
  it('rejects non-integer / non-positive', () => {
    expect(validateFundingAmount(-100).valid).toBe(false);
    expect(validateFundingAmount(1.5).valid).toBe(false);
  });
});
