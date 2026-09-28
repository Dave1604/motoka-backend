import { describe, it, expect } from '@jest/globals';
import { sanitizeAttribution, buildPaymentMetadata } from '../utils/paymentHelpers.js';

describe('sanitizeAttribution', () => {
  it('keeps trimmed source and campaign with a capture timestamp', () => {
    const result = sanitizeAttribution({ source: ' google ', campaign: ' sept-push ' });
    expect(result.source).toBe('google');
    expect(result.campaign).toBe('sept-push');
    expect(typeof result.captured_at).toBe('string');
  });

  it('keeps whichever half is present', () => {
    expect(sanitizeAttribution({ source: 'blog' })).toMatchObject({ source: 'blog' });
    expect(sanitizeAttribution({ campaign: 'x' })).toMatchObject({ campaign: 'x' });
  });

  it('collapses junk to null so it never poisons a payment record', () => {
    for (const junk of [null, undefined, 'google', 42, [], {}, { source: '  ' }]) {
      expect(sanitizeAttribution(junk)).toBeNull();
    }
  });

  it('caps lengths', () => {
    const result = sanitizeAttribution({ source: 's'.repeat(200), campaign: 'c'.repeat(500) });
    expect(result.source).toHaveLength(60);
    expect(result.campaign).toHaveLength(120);
  });
});

describe('buildPaymentMetadata attribution', () => {
  const base = {
    carId: 1,
    carSlug: 'abc',
    paymentType: 'renewal_manual',
    renewalMonths: 12,
    userId: 'u1',
  };

  it('omits attribution when none is supplied', () => {
    expect(buildPaymentMetadata(base)).not.toHaveProperty('attribution');
  });

  it('carries sanitized attribution through', () => {
    const meta = buildPaymentMetadata({
      ...base,
      attribution: sanitizeAttribution({ source: 'blog', campaign: 'seo' }),
    });
    expect(meta.attribution).toMatchObject({ source: 'blog', campaign: 'seo' });
  });
});
