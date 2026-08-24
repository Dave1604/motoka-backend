import { describe, it, expect } from '@jest/globals';
import { estimateWeightKg, toTerminalWeightKg } from '../services/courier/parcel.weight.js';

describe('estimateWeightKg', () => {
  it('uses plate and DL defaults', () => {
    expect(estimateWeightKg({ purpose: 'plate_number' })).toBeGreaterThan(0.5);
    expect(estimateWeightKg({ purpose: 'driver_license' })).toBeLessThan(0.5);
  });

  it('sums document weights with a packaging floor', () => {
    const kg = estimateWeightKg({ purpose: 'renewal', selectedItems: ['vehicle_licence'] });
    expect(kg).toBeGreaterThanOrEqual(0.2);
  });

  it('never sends Terminal a weight under 0.1 kg', () => {
    expect(toTerminalWeightKg(0.05)).toBe(0.1);
    expect(toTerminalWeightKg(0)).toBeGreaterThanOrEqual(0.1);
    expect(toTerminalWeightKg(NaN)).toBeGreaterThanOrEqual(0.1);
  });
});
