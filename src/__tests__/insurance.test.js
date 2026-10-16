import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Insurance service against the Curacel API shape verified in the sandbox on
 * 2026-10-16: products matched on product_type.slug, quotes keyed by ref,
 * acceptance paid from our wallet, policy read back off the order.
 */

const curacel = {
  listProducts: jest.fn(),
  ensureCustomer: jest.fn(),
  createAttachmentFromUrl: jest.fn(),
  createQuote: jest.fn(),
  acceptQuote: jest.fn(),
  getOrder: jest.fn(),
  getPolicy: jest.fn(),
  isConfigured: jest.fn(() => true),
};
class CuracelError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message); this.statusCode = statusCode; this.code = code;
  }
}
const mockFrom = jest.fn();

jest.unstable_mockModule('../services/insurance/curacel.service.js', () => ({ ...curacel, CuracelError }));
jest.unstable_mockModule('../config/supabase.js', () => ({ getSupabaseAdmin: () => ({ from: mockFrom }) }));
jest.unstable_mockModule('../utils/logger.js', () => ({
  logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn(), logDebug: jest.fn(),
}));

const { quoteVehicle, purchasePolicy } = await import('../services/insurance/insurance.service.js');

function builder(result) {
  const chain = {};
  for (const m of ['select', 'eq', 'insert', 'update', 'order', 'limit']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.single = jest.fn(async () => result);
  chain.maybeSingle = jest.fn(async () => result);
  chain.then = (resolve) => Promise.resolve(result).then(resolve);
  return chain;
}

const PRODUCTS = [
  { code: 'EASYCARE', product_type: { slug: 'health' }, insurer: { name: 'AXA' } },
  { code: '3rd_party_motor', product_type: { slug: '3rd_party_auto' }, insurer: { name: 'Tangerine Insurance' } },
  { code: 'FlexiMotor', product_type: { slug: 'comprehensive_auto' }, insurer: { name: 'Tangerine Insurance' } },
];
const CUSTOMER = {
  ref: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B', phone: '080', birthDate: '1990-01-01', address: '1 St',
};
const VEHICLE = {
  registrationNumber: 'ABC123XY', make: 'Toyota', model: 'Corolla', year: 2018, color: 'Black',
  chassisNumber: 'CH1', engineNumber: 'EN1', value: 4500000, assetRef: 'motoka-car-1',
};
const LICENCE = { number: 'DL1', documentUrl: 'https://x/licence.jpg' };

beforeEach(() => {
  for (const fn of Object.values(curacel)) fn.mockReset?.();
  mockFrom.mockReset();
  curacel.listProducts.mockResolvedValue(PRODUCTS);
  curacel.ensureCustomer.mockResolvedValue({ ref: 'u1' });
  curacel.createAttachmentFromUrl.mockResolvedValue(1779);
});

describe('quoteVehicle', () => {
  it('registers the customer and licence once, then quotes each cover by product type', async () => {
    curacel.createQuote
      .mockResolvedValueOnce({ ref: 'q-1', product_price: 15000, amount_due: 14700, currency: 'NGN' })
      .mockResolvedValueOnce({ ref: 'q-2', product_price: 225000, amount_due: 220500, currency: 'NGN' });

    const { quotes, failures } = await quoteVehicle({ customer: CUSTOMER, vehicle: VEHICLE, licence: LICENCE });

    expect(curacel.ensureCustomer).toHaveBeenCalledTimes(1);
    expect(curacel.createAttachmentFromUrl).toHaveBeenCalledTimes(1);
    expect(curacel.createQuote).toHaveBeenCalledTimes(2);

    const [third, comp] = curacel.createQuote.mock.calls.map((c) => c[0]);
    expect(third.productCode).toBe('3rd_party_motor');
    expect(third.assetValue).toBeUndefined();
    expect(third.driversLicenceAttachmentId).toBe(1779);
    expect(third.vehicle.vehicleClass).toBe('car');
    expect(comp.productCode).toBe('FlexiMotor');
    expect(comp.assetValue).toBe(4500000);

    expect(failures).toEqual([]);
    expect(quotes).toEqual([
      expect.objectContaining({ quotationId: 'q-1', coverType: 'third_party', premiumKobo: 1500000, amountDueKobo: 1470000, insurer: 'Tangerine Insurance' }),
      expect.objectContaining({ quotationId: 'q-2', coverType: 'comprehensive', premiumKobo: 22500000 }),
    ]);
  });

  it('still returns third-party when comprehensive has no vehicle value', async () => {
    curacel.createQuote.mockResolvedValueOnce({ ref: 'q-1', product_price: 15000, amount_due: 14700 });

    const { quotes, failures } = await quoteVehicle({
      customer: CUSTOMER, vehicle: { ...VEHICLE, value: null }, licence: LICENCE,
    });

    expect(curacel.createQuote).toHaveBeenCalledTimes(1);
    expect(quotes).toHaveLength(1);
    expect(failures).toEqual([{ coverType: 'comprehensive', reason: expect.stringMatching(/value/i) }]);
  });

  it('rejects an unknown cover type before touching the provider', async () => {
    await expect(quoteVehicle({ customer: CUSTOMER, vehicle: VEHICLE, licence: LICENCE, coverTypes: ['fire'] }))
      .rejects.toMatchObject({ code: 'INVALID_COVER_TYPE' });
    expect(curacel.listProducts).not.toHaveBeenCalled();
  });
});

describe('purchasePolicy', () => {
  it('records pending, accepts the quote, then stores the issued policy from the order', async () => {
    const insertChain = builder({ data: { id: 'p1' }, error: null });
    const updateChain = builder({ data: { id: 'p1', status: 'active' }, error: null });
    mockFrom.mockReturnValueOnce(insertChain).mockReturnValueOnce(updateChain);

    curacel.acceptQuote.mockResolvedValue({ id: 21595, status: 'paid', product_price: 15000 });
    curacel.getOrder.mockResolvedValue({
      id: 21595, status: 'policy_created', product_price: 15000,
      product: { insurer: { name: 'Tangerine Insurance' } },
      policy: { number: 'CUR/X/1', start_date: '2026-10-17T00:00:00Z', end_date: '2027-10-17T00:00:00Z', status: 'active' },
    });

    const result = await purchasePolicy({ userId: 'u1', carId: 1, quotationId: 'q-1', coverType: 'third_party' });

    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending', provider_quotation_id: 'q-1', cover_type: 'third_party',
    }));
    expect(curacel.acceptQuote).toHaveBeenCalledWith({ quoteRef: 'q-1' });
    expect(updateChain.update).toHaveBeenCalledWith({
      status: 'active',
      policy_number: 'CUR/X/1',
      insurer: 'Tangerine Insurance',
      premium_kobo: 1500000,
      starts_at: '2026-10-17T00:00:00Z',
      expires_at: '2027-10-17T00:00:00Z',
      provider_reference: '21595',
    });
    expect(result.status).toBe('active');
  });

  it('leaves the row pending when the order has no policy yet', async () => {
    mockFrom
      .mockReturnValueOnce(builder({ data: { id: 'p1' }, error: null }))
      .mockReturnValueOnce(builder({ data: { id: 'p1', status: 'pending' }, error: null }));
    curacel.acceptQuote.mockResolvedValue({ id: 5, status: 'paid', product_price: 15000 });
    curacel.getOrder.mockResolvedValue({ id: 5, status: 'paid', product_price: 15000, policy: null });

    const result = await purchasePolicy({ userId: 'u1', carId: 1, quotationId: 'q-1', coverType: 'third_party' });
    expect(result.status).toBe('pending');
  });

  it('marks the row failed and rethrows when acceptance is rejected', async () => {
    const failChain = builder({ data: null, error: null });
    mockFrom.mockReturnValueOnce(builder({ data: { id: 'p1' }, error: null })).mockReturnValueOnce(failChain);
    curacel.acceptQuote.mockRejectedValue(new CuracelError('Insufficient wallet balance', 422, 'WALLET'));

    await expect(purchasePolicy({ userId: 'u1', carId: 1, quotationId: 'q-1', coverType: 'third_party' }))
      .rejects.toMatchObject({ message: 'Insufficient wallet balance' });
    expect(failChain.update).toHaveBeenCalledWith({ status: 'failed', failure_reason: 'Insufficient wallet balance' });
  });
});
