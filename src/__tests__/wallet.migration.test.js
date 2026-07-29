import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Regression guard for the wallet ledger migration.
 *
 * The wallet is money, so the correctness-critical invariants live in SQL:
 *   - balance can never go negative,
 *   - a ledger entry's amount is always positive,
 *   - `reference` is UNIQUE so a replayed Paystack webhook cannot double-credit,
 *   - wallet_credit() locks the row (FOR UPDATE), checks idempotency, and has a
 *     unique_violation backstop for the race.
 *
 * A mocked unit test cannot catch a regression here — this reads the latest
 * migration defining the wallet and asserts the safe forms, so a future edit
 * that drops the guard fails CI instead of silently breaking money handling.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

function latestWalletMigration() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (parseInt(b.match(/^(\d+)/)?.[1] ?? '0', 10)) - (parseInt(a.match(/^(\d+)/)?.[1] ?? '0', 10)));
  for (const f of files) {
    const raw = readFileSync(join(migrationsDir, f), 'utf8');
    if (/FUNCTION\s+(public\.)?wallet_credit/i.test(raw)) return { file: f, sql: stripSqlComments(raw) };
  }
  return null;
}

function stripSqlComments(sql) {
  return sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
}

describe('wallet migration guard', () => {
  const def = latestWalletMigration();

  it('a migration defining wallet_credit exists', () => {
    expect(def).not.toBeNull();
  });

  it('enforces a non-negative balance at the table level', () => {
    expect(def.sql).toMatch(/balance_kobo\s+BIGINT[^,]*CHECK\s*\(\s*balance_kobo\s*>=\s*0\s*\)/i);
  });

  it('requires positive ledger amounts', () => {
    expect(def.sql).toMatch(/amount_kobo\s+BIGINT[^,]*CHECK\s*\(\s*amount_kobo\s*>\s*0\s*\)/i);
  });

  it('makes ledger reference UNIQUE (idempotency key)', () => {
    expect(def.sql).toMatch(/reference\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
  });

  it('wallet_credit locks the wallet row before mutating', () => {
    expect(def.sql).toMatch(/FOR\s+UPDATE/i);
  });

  it('wallet_credit is idempotent on reference and has a unique_violation backstop', () => {
    expect(def.sql).toMatch(/WHERE\s+reference\s*=\s*p_reference/i);
    expect(def.sql).toMatch(/WHEN\s+unique_violation\s+THEN/i);
  });

  it('enables row-level security on both wallet tables', () => {
    expect(def.sql).toMatch(/ALTER\s+TABLE\s+public\.wallets\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(def.sql).toMatch(/ALTER\s+TABLE\s+public\.wallet_ledger\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
