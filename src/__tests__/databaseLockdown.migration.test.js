import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Regression guard for migration 122. Mocks cannot catch this: the holes live in
 * database grants, so a customer could reach them without touching this backend.
 */
const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations', '122_lock_down_public_database_access.sql'),
  'utf8'
);
const statements = sql.replace(/--.*$/gm, '');

describe('database lockdown migration', () => {
  it('replaces the table-wide profile update with a column allowlist', () => {
    expect(statements).toMatch(/REVOKE UPDATE ON public\.profiles FROM anon, authenticated/);

    const grant = statements.match(/GRANT UPDATE \(([^)]+)\)\s+ON public\.profiles TO authenticated/);
    expect(grant).not.toBeNull();
    const columns = grant[1].split(',').map((c) => c.trim());
    for (const sensitive of ['is_admin', 'is_suspended', 'user_type_id', 'deleted_at', 'email', 'email_verified_at', 'plate_bonus_credited', 'plate_verification_status', 'two_factor_secret']) {
      expect(columns).not.toContain(sensitive);
    }
  });

  it('closes every SECURITY DEFINER function and leaves the service role working', () => {
    expect(statements).toMatch(/p\.prosecdef/);
    expect(statements).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(statements).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it('keeps new functions closed by default', () => {
    expect(statements).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
    expect(statements).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated/);
  });
});
