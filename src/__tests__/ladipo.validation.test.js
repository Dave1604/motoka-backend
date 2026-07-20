import { describe, it, expect } from '@jest/globals';
import {
  ladipoAddToCartBodySchema,
  ladipoCreateOrderBodySchema,
  ladipoOrderNumberParamSchema,
  ladipoPayOrderBodySchema,
  ladipoVerifyPaymentBodySchema,
  ladipoCartItemIdParamSchema,
  ladipoCompatibilityBodySchema,
} from '../validators/ladipo.validation.js';

describe('Ladipo Zod validators', () => {
  it('rejects add-to-cart without UUID product_id', () => {
    const r = ladipoAddToCartBodySchema.safeParse({ product_id: 'not-a-uuid', quantity: 1 });
    expect(r.success).toBe(false);
  });

  it('accepts valid add-to-cart', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const r = ladipoAddToCartBodySchema.safeParse({ product_id: id, quantity: 2 });
    expect(r.success).toBe(true);
    expect(r.data.product_id).toBe(id);
    expect(r.data.quantity).toBe(2);
  });

  it('createOrder requires delivery.state when method is not pickup', () => {
    const inv = '550e8400-e29b-41d4-a716-446655440001';
    const bad = ladipoCreateOrderBodySchema.safeParse({
      items: [{ inventory_id: inv, quantity: 1 }],
      delivery: { method: 'standard' },
    });
    expect(bad.success).toBe(false);

    const good = ladipoCreateOrderBodySchema.safeParse({
      items: [{ inventory_id: inv, quantity: 1 }],
      delivery: { method: 'standard', state: 'Lagos' },
    });
    expect(good.success).toBe(true);
  });

  it('createOrder allows pickup without state', () => {
    const inv = '550e8400-e29b-41d4-a716-446655440002';
    const r = ladipoCreateOrderBodySchema.safeParse({
      items: [{ inventory_id: inv, quantity: 1 }],
      delivery: { method: 'pickup' },
    });
    expect(r.success).toBe(true);
  });

  it('orderNumber param allows LAD-* style', () => {
    const r = ladipoOrderNumberParamSchema.safeParse({ orderNumber: 'LAD-MH7K2ABC' });
    expect(r.success).toBe(true);
  });

  it('pay body defaults payment_gateway', () => {
    const r = ladipoPayOrderBodySchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data.payment_gateway).toBe('paystack');
  });

  it('verify payment reference length', () => {
    expect(ladipoVerifyPaymentBodySchema.safeParse({ reference: 'short' }).success).toBe(false);
    expect(ladipoVerifyPaymentBodySchema.safeParse({ reference: 'valid_ref_12345678' }).success).toBe(true);
  });

  it('cart item id must be uuid', () => {
    expect(ladipoCartItemIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
    expect(
      ladipoCartItemIdParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440099' }).success
    ).toBe(true);
  });

  it('accepts optional model/year bounds for an explicit fitment rule', () => {
    const r = ladipoCompatibilityBodySchema.safeParse({
      entries: [{ make: 'Mercedes Benz', model: 'C-Class', year_min: 2015, year_max: 2020 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an inverted compatibility year range', () => {
    const r = ladipoCompatibilityBodySchema.safeParse({
      entries: [{ make: 'Toyota', model: 'Camry', year_min: 2021, year_max: 2020 }],
    });
    expect(r.success).toBe(false);
  });
});
