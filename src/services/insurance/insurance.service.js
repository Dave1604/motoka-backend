// Insurance business logic. Talks to Curacel through curacel.service.js and
// normalises everything into our own shape, so the rest of the app never sees
// a provider-specific field. If Curacel is ever swapped out, only these two
// files change.
import {
  createCustomer,
  createQuotation,
  createOrder,
  getPolicy as getProviderPolicy,
  listProducts,
  CuracelError
} from './curacel.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import {
  COVER_TYPE,
  POLICY_STATUS,
  NIID_STATUS,
  INSURANCE_ERROR_MESSAGES
} from '../../constants/insurance.constants.js';

export class InsuranceError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = 'InsuranceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Premiums are handled in kobo throughout, matching how payment/wallet already
// work in this codebase. Mixing naira and kobo is the classic source of
// off-by-100 money bugs, so conversion happens once, here, at the provider
// boundary.
function toKobo(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Normalise a provider quotation into our own shape.
 * Field names on the Curacel side are defensive — see the note in
 * insurance.constants.js about confirming payload shapes against sandbox.
 */
function normaliseQuote(raw, coverType) {
  const premium = raw?.premium ?? raw?.amount ?? raw?.data?.premium;
  return {
    quotationId: raw?.id ?? raw?.quotation_id ?? raw?.data?.id,
    coverType,
    premiumKobo: toKobo(premium),
    insurer: raw?.insurer_name ?? raw?.insurer ?? null,
    productId: raw?.product_id ?? null,
    expiresAt: raw?.expires_at ?? null
  };
}

/**
 * Quote a vehicle for the requested cover types.
 *
 * Read-only: no money moves, nothing is persisted. Safe to call whenever the
 * renewal flow needs to show a real price. Quoting both cover types in
 * parallel is deliberate — showing comprehensive next to third-party is the
 * upsell, and a sequential pair of calls would make the page feel slow.
 */
export async function quoteVehicle({ vehicle, customerId, coverTypes }) {
  const wanted = coverTypes?.length
    ? coverTypes
    : [COVER_TYPE.THIRD_PARTY, COVER_TYPE.COMPREHENSIVE];

  for (const t of wanted) {
    if (!Object.values(COVER_TYPE).includes(t)) {
      throw new InsuranceError(INSURANCE_ERROR_MESSAGES.INVALID_COVER_TYPE, 400, 'INVALID_COVER_TYPE');
    }
  }

  // Product IDs are per-partner, so resolve them rather than hardcoding.
  const products = await listProducts();
  const list = products?.data ?? products ?? [];

  const results = await Promise.allSettled(
    wanted.map((coverType) => {
      const product = findMotorProduct(list, coverType);
      if (!product) {
        return Promise.reject(
          new InsuranceError(`No ${coverType} motor product available on this account`, 404, 'NO_PRODUCT')
        );
      }
      return createQuotation({ productId: product.id, vehicle, customerId })
        .then((raw) => normaliseQuote(raw, coverType));
    })
  );

  // One cover type failing should not blank the whole page — return what we
  // have and report the rest, so the customer can still buy third-party if
  // comprehensive quoting is down.
  const quotes = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else failures.push({ coverType: wanted[i], reason: r.reason?.message });
  });

  if (!quotes.length) {
    logError('All insurance quotes failed', { failures });
    throw new InsuranceError(INSURANCE_ERROR_MESSAGES.QUOTE_FAILED, 502, 'QUOTE_FAILED');
  }

  return { quotes, failures };
}

// Motor products are matched by cover type on the product record. Kept as one
// function so the matching heuristic is in a single place if Curacel's product
// taxonomy differs from what we expect.
function findMotorProduct(products, coverType) {
  return products.find((p) => {
    const name = `${p?.name ?? ''} ${p?.slug ?? ''} ${p?.category ?? ''}`.toLowerCase();
    const isMotor = name.includes('motor') || name.includes('auto') || name.includes('vehicle');
    if (!isMotor) return false;
    return coverType === COVER_TYPE.COMPREHENSIVE
      ? name.includes('comprehensive')
      : name.includes('third') || name.includes('tpl');
  });
}

/**
 * Purchase a quoted policy and persist it against the car.
 *
 * Deliberately writes a `pending` row *before* calling the provider. If the
 * provider call succeeds but our process dies before we record it, we would
 * otherwise have taken money for a policy with no local trace. A pending row
 * that can be reconciled is recoverable; a missing one is not.
 */
export async function purchasePolicy({ userId, carId, quotationId, coverType, customer }) {
  const supabase = getSupabaseAdmin();

  const providerCustomer = await createCustomer(customer).catch((err) => {
    logError('Curacel customer creation failed', { error: err.message });
    throw err;
  });
  const customerId = providerCustomer?.id ?? providerCustomer?.data?.id;

  const { data: pending, error: insertError } = await supabase
    .from('insurance_policies')
    .insert({
      user_id: userId,
      car_id: carId,
      cover_type: coverType,
      status: POLICY_STATUS.PENDING,
      niid_status: NIID_STATUS.PENDING,
      provider: 'curacel',
      provider_quotation_id: quotationId
    })
    .select()
    .single();

  if (insertError) {
    logError('Failed to record pending policy', { error: insertError.message });
    throw new InsuranceError('Could not record the policy', 500, 'DB_ERROR');
  }

  try {
    const order = await createOrder({
      quotationId,
      customerId,
      metadata: { motoka_policy_id: pending.id, car_id: carId }
    });

    const policyNumber = order?.policy_number ?? order?.data?.policy_number ?? null;
    const providerRef = order?.id ?? order?.data?.id ?? null;

    // Issuance may be asynchronous. Only mark active once the provider says
    // so; otherwise leave it pending for the webhook or reconciliation to
    // resolve. Reporting a policy as active before it exists is precisely the
    // failure mode this product is meant to eliminate.
    const issued = Boolean(policyNumber);

    const { data: updated } = await supabase
      .from('insurance_policies')
      .update({
        status: issued ? POLICY_STATUS.ACTIVE : POLICY_STATUS.PENDING,
        policy_number: policyNumber,
        provider_reference: providerRef,
        insurer: order?.insurer_name ?? null,
        premium_kobo: toKobo(order?.premium ?? order?.amount),
        starts_at: order?.start_date ?? null,
        expires_at: order?.end_date ?? null
      })
      .eq('id', pending.id)
      .select()
      .single();

    logInfo('Insurance policy purchased', {
      policyId: pending.id,
      issued,
      carId
    });

    return updated ?? pending;
  } catch (err) {
    await supabase
      .from('insurance_policies')
      .update({
        status: POLICY_STATUS.FAILED,
        failure_reason: err instanceof CuracelError ? err.message : 'Unknown provider error'
      })
      .eq('id', pending.id);

    logError('Insurance purchase failed after recording pending policy', {
      policyId: pending.id,
      error: err.message
    });
    throw err;
  }
}

/**
 * Current policy for a vehicle, from our own records.
 */
export async function getPolicyForCar(carId, userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('insurance_policies')
    .select('*')
    .eq('car_id', carId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logError('Failed to read policy', { error: error.message });
    throw new InsuranceError('Could not read the policy', 500, 'DB_ERROR');
  }
  return data;
}

/**
 * Re-read a pending policy from the provider and settle its status.
 *
 * Webhooks get missed — dropped deliveries, deploys mid-flight, signature
 * mismatches. This is the safety net that stops a customer's policy sitting
 * "pending" forever because one HTTP callback never arrived.
 */
export async function reconcilePolicy(policyId) {
  const supabase = getSupabaseAdmin();
  const { data: policy } = await supabase
    .from('insurance_policies')
    .select('*')
    .eq('id', policyId)
    .single();

  if (!policy?.provider_reference) return policy;

  const remote = await getProviderPolicy(policy.provider_reference);
  const policyNumber = remote?.policy_number ?? remote?.data?.policy_number ?? null;
  const niidRegistered = Boolean(remote?.niid_registered ?? remote?.data?.niid_registered);

  const { data: updated } = await supabase
    .from('insurance_policies')
    .update({
      status: policyNumber ? POLICY_STATUS.ACTIVE : policy.status,
      policy_number: policyNumber ?? policy.policy_number,
      niid_status: niidRegistered ? NIID_STATUS.REGISTERED : policy.niid_status,
      expires_at: remote?.end_date ?? policy.expires_at
    })
    .eq('id', policyId)
    .select()
    .single();

  return updated;
}
