import { describe, it, expect } from '@jest/globals';
import { buildDeliveryProgress, hasDeliveryDetails, mapCourierStage } from '../services/courier/deliveryProgress.service.js';

describe('hasDeliveryDetails', () => {
  it('detects address or fee', () => {
    expect(hasDeliveryDetails({ delivery_address: '12 Broad St' })).toBe(true);
    expect(hasDeliveryDetails({ delivery_fee: 138843 })).toBe(true);
    expect(hasDeliveryDetails({ delivery_details: { address: '12 Broad St' } })).toBe(true);
    expect(hasDeliveryDetails({ status: 'pending' })).toBe(false);
  });
});

describe('mapCourierStage', () => {
  it('maps Terminal statuses', () => {
    expect(mapCourierStage({ status: 'confirmed' }, { waybill_number: 'SH-1' })).toBe('booked');
    expect(mapCourierStage({ status: 'picked-up' }, { waybill_number: 'SH-1' })).toBe('in_transit');
    expect(mapCourierStage({ status: 'out-for-delivery' }, { waybill_number: 'SH-1' })).toBe('in_transit');
    expect(mapCourierStage({ status: 'delivered' }, { waybill_number: 'SH-1' })).toBe('delivered');
    expect(mapCourierStage(null, null)).toBe(null);
  });
});

describe('buildDeliveryProgress', () => {
  it('starts at paid after checkout with delivery', () => {
    const progress = buildDeliveryProgress({
      order: { status: 'pending', delivery_address: '12 Broad St', order_number: 'RN-1' },
    });
    expect(progress.has_delivery).toBe(true);
    expect(progress.current_key).toBe('paid');
    expect(progress.steps.find((s) => s.key === 'paid').current).toBe(true);
  });

  it('moves to processing when admin marks in progress', () => {
    const progress = buildDeliveryProgress({
      order: { status: 'processing', delivery_address: '12 Broad St' },
    });
    expect(progress.current_key).toBe('processing');
    expect(progress.steps.find((s) => s.key === 'paid').done).toBe(true);
  });

  it('moves to booked after waybill even if Motoka is still pending', () => {
    const progress = buildDeliveryProgress({
      order: { status: 'pending', delivery_address: '12 Broad St' },
      shipment: { waybill_number: 'SH-99', tracking_url: 'https://track.example' },
      tracking: { status: 'confirmed' },
    });
    expect(progress.current_key).toBe('booked');
    expect(progress.waybill_number).toBe('SH-99');
    expect(progress.tracking_url).toBe('https://track.example');
  });

  it('uses courier in-transit and delivered', () => {
    const inTransit = buildDeliveryProgress({
      order: { status: 'processing', delivery_address: '12 Broad St' },
      shipment: { waybill_number: 'SH-99' },
      tracking: { status: 'in-transit' },
    });
    expect(inTransit.current_key).toBe('in_transit');

    const delivered = buildDeliveryProgress({
      order: { status: 'completed', delivery_address: '12 Broad St' },
      shipment: { waybill_number: 'SH-99' },
      tracking: { status: 'delivered' },
    });
    expect(delivered.current_key).toBe('delivered');
    expect(delivered.steps.every((s) => s.done || s.current)).toBe(true);
  });

  it('uses documents-ready steps when delivery was not requested', () => {
    const progress = buildDeliveryProgress({
      order: { status: 'completed', order_number: 'RN-2' },
    });
    expect(progress.has_delivery).toBe(false);
    expect(progress.current_key).toBe('ready');
    expect(progress.steps.map((s) => s.key)).toEqual(['paid', 'processing', 'ready']);
  });

  it('treats a paid guest order as documents in progress until a waybill exists', () => {
    const progress = buildDeliveryProgress({
      guestOrder: { payment_status: 'payment_success', delivery_details: { address: '12 Broad St' } },
    });
    expect(progress.has_delivery).toBe(true);
    expect(progress.current_key).toBe('processing');
  });
});
