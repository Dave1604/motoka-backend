// Insurance business logic. Talks to Curacel through curacel.service.js and
// normalises everything into our own shape, so the rest of the app never sees
// a provider-specific field. If Curacel is ever swapped out, only these two
// files change.
import {
  ensureCustomer,
  createAttachmentFromUrl,
  createQuote,
  acceptQuote,
  getOrder,
  listProducts,
  CuracelError
} from './curacel.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import {
  COVER_TYPE,
  CURACEL_MOTOR_TYPE_SLUG,
  CURACEL_DEFAULT_VEHICLE_CLASS,
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Motor products are matched on Curacel's product_type.slug. Where a partner
// has several products of one type (sandbox has two comprehensive ones) the
// first listed wins; Curacel orders by creation, so that is the longest-standing.
function findMotorProduct(products, coverType) {
  const slug = CURACEL_MOTOR_TYPE_SLUG[coverType];
  return products.find((p) => p?.product_type?.slug === slug) || null;
}

/**
 * Quote a vehicle for the requested cover types.
 *
 * Nothing is persisted, but this is not a free estimate: Curacel will only
 * price a named customer with a driver's licence on file, so the customer is
 * registered and the licence attached before any quote is requested. Both
 * cover types are quoted in parallel because comprehensive next to
 * third-party is the upsell.
 *
 * @param {Object} params
 * @param {Object} params.customer - { ref, email, firstName, lastName, phone, birthDate, address }
 * @param {Object} params.vehicle - { registrationNumber, make, model, year, color, chassisNumber, engineNumber, value }
 * @param {Object} params.licence - { number, documentUrl }
 * @param {string[]} [params.coverTypes]
 */
export async function quoteVehicle({ customer, vehicle, licence, coverTypes }) {
  const wanted = coverTypes?.length
    ? coverTypes
    : [COVER_TYPE.THIRD_PARTY, COVER_TYPE.COMPREHENSIVE];

  for (const t of wanted) {
    if (!Object.values(COVER_TYPE).includes(t)) {
      throw new InsuranceError(INSURANCE_ERROR_MESSAGES.INVALID_COVER_TYPE, 400, 'INVALID_COVER_TYPE');
    }
  }

  const products = await listProducts();
  await ensureCustomer(customer);
  const attachmentId = await createAttachmentFromUrl({
    fileUrl: licence.documentUrl,
    description: `Driver's licence ${licence.number}`
  });

  const policyStartDate = todayIso();
  const results = await Promise.allSettled(
    wanted.map((coverType) => {
      const product = findMotorProduct(products, coverType);
      if (!product) {
        return Promise.reject(
          new InsuranceError(`No ${coverType} motor product available on this account`, 404, 'NO_PRODUCT')
        );
      }
      if (coverType === COVER_TYPE.COMPREHENSIVE && !(vehicle.value > 0)) {
        return Promise.reject(
          new InsuranceError(INSURANCE_ERROR_MESSAGES.VEHICLE_VALUE_REQUIRED, 400, 'VEHICLE_VALUE_REQUIRED')
        );
      }
      return createQuote({
        productCode: product.code,
        customerRef: customer.ref,
        policyStartDate,
        vehicle: { ...vehicle, vehicleClass: CURACEL_DEFAULT_VEHICLE_CLASS },
        driversLicenceNumber: licence.number,
        driversLicenceAttachmentId: attachmentId,
        assetValue: coverType === COVER_TYPE.COMPREHENSIVE ? vehicle.value : undefined,
        assetRef: vehicle.assetRef
      }).then((quote) => ({
        quotationId: quote.ref,
        coverType,
        productCode: product.code,
        insurer: product.insurer?.name ?? null,
        premiumKobo: toKobo(quote.product_price),
        amountDueKobo: toKobo(quote.amount_due),
        currency: quote.currency ?? 'NGN',
        policyStartDate
      }));
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

/**
 * Accept a quote and persist the resulting policy against the car.
 *
 * Acceptance is paid from Motoka's prepaid Curacel wallet, not by the
 * customer: nothing here charges them. Until the renewal checkout collects
 * the premium, this must stay behind INSURANCE_ENABLED.
 *
 * Writes a `pending` row *before* calling the provider. If the provider call
 * succeeds but our process dies before we record it, we would otherwise have
 * paid for a policy with no local trace. A pending row that can be reconciled
 * is recoverable; a missing one is not.
 */
export async function purchasePolicy({ userId, carId, quotationId, coverType }) {
  const supabase = getSupabaseAdmin();

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
    const accepted = await acceptQuote({ quoteRef: quotationId });
    // The accept response has no policy or product; one read gets both.
    const order = (await getOrder(accepted.id)) ?? accepted;
    const fields = policyFields(order);

    const { data: updated } = await supabase
      .from('insurance_policies')
      .update({ ...fields, provider_reference: String(order.id) })
      .eq('id', pending.id)
      .select()
      .single();

    logInfo('Insurance policy purchased', {
      policyId: pending.id,
      issued: fields.status === POLICY_STATUS.ACTIVE,
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

// Issuance is synchronous when the wallet covers the order, but only the
// policy number proves it. Reporting a policy as active before it exists is
// precisely the failure mode this product is meant to eliminate.
function policyFields(order) {
  const policy = order?.policy;
  const issued = Boolean(policy?.number);
  return {
    status: issued ? POLICY_STATUS.ACTIVE : POLICY_STATUS.PENDING,
    policy_number: policy?.number ?? null,
    insurer: policy?.insurer?.name ?? order?.product?.insurer?.name ?? null,
    premium_kobo: toKobo(order?.product_price),
    starts_at: policy?.start_date ?? null,
    expires_at: policy?.end_date ?? null
  };
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
 * Curacel has no webhook for us, so this is the only way a policy that was
 * paid for but not recorded (deploy mid-flight, provider timeout after
 * charging the wallet) ever stops sitting "pending".
 */
export async function reconcilePolicy(policyId) {
  const supabase = getSupabaseAdmin();
  const { data: policy } = await supabase
    .from('insurance_policies')
    .select('*')
    .eq('id', policyId)
    .single();

  if (!policy?.provider_reference) return policy;

  const order = await getOrder(policy.provider_reference);
  const fields = policyFields(order);
  if (fields.status !== POLICY_STATUS.ACTIVE) return policy;

  const { data: updated } = await supabase
    .from('insurance_policies')
    .update(fields)
    .eq('id', policyId)
    .select()
    .single();

  return updated;
}
