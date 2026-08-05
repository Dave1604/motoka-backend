import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');
const migrationPath = join(migrationsDir, '082_referral_system.sql');

describe('referral migration 082', () => {
  it('exists', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('creates settings, codes, referrals and extends wallet reason', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_settings/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_codes/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.referrals/i);
    expect(sql).toMatch(/referrer_reward_kobo/i);
    expect(sql).toMatch(/referee_reward_kobo/i);
    expect(sql).toMatch(/DEFAULT 30000/);
    expect(sql).toMatch(/referrals_no_self/);
    expect(sql).toMatch(/wallet_ledger_reason_check/);
    expect(sql).toMatch(/'referral'/);
    expect(sql).toMatch(/status IN \('pending', 'qualified', 'rewarded', 'rejected'\)/);
  });
});
