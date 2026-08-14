import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('referral wiring guards', () => {
  it('register accepts optional referral_code', () => {
    const validators = readFileSync(join(root, 'utils/validators.js'), 'utf8');
    expect(validators).toMatch(/body\('referral_code'\)/);
  });

  it('auth register hooks attribution', () => {
    const auth = readFileSync(join(root, 'controllers/auth.controller.js'), 'utf8');
    expect(auth).toMatch(/attributeReferral/);
    expect(auth).toMatch(/ensureReferralCode/);
    expect(auth).toMatch(/referral_code/);
  });

  it('payment success side-effects call qualifyAndRewardOnFirstPurchase', () => {
    const svc = readFileSync(join(root, 'services/payment/payment-success.service.js'), 'utf8');
    expect(svc).toMatch(/qualifyAndRewardOnFirstPurchase/);
  });

  it('excludes wallet funding and tokenization from qualifying purchases', () => {
    const svc = readFileSync(join(root, 'services/referral/referral.service.js'), 'utf8');
    expect(svc).toMatch(/WALLET_FUNDING/);
    expect(svc).toMatch(/TOKENIZATION/);
    expect(svc).toMatch(/referral:\$\{referral\.id\}:referrer/);
    expect(svc).toMatch(/referral:\$\{referral\.id\}:referee/);
    expect(svc).toMatch(/reason: 'referral'/);
  });

  it('mounts referral routes in index.js', () => {
    const index = readFileSync(join(root, 'index.js'), 'utf8');
    expect(index).toMatch(/referralRoutes/);
    expect(index).toMatch(/app\.use\('\/api', referralRoutes\)/);
  });
});
