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

// ── Phase 2: pay_with_wallet ────────────────────────────────────────────────
function latestPayWithWallet() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (parseInt(b.match(/^(\d+)/)?.[1] ?? '0', 10)) - (parseInt(a.match(/^(\d+)/)?.[1] ?? '0', 10)));
  for (const f of files) {
    const raw = readFileSync(join(migrationsDir, f), 'utf8');
    if (/FUNCTION\s+(public\.)?pay_with_wallet/i.test(raw)) return { file: f, sql: stripSqlComments(raw) };
  }
  return null;
}

describe('pay_with_wallet migration guard', () => {
  const def = latestPayWithWallet();

  it('a migration defining pay_with_wallet exists', () => {
    expect(def).not.toBeNull();
  });

  it('locks the wallet row before checking/spending balance', () => {
    expect(def.sql).toMatch(/FOR\s+UPDATE/i);
  });

  it('rejects spending more than the balance', () => {
    expect(def.sql).toMatch(/balance_kobo\s*<\s*p_amount_kobo/i);
    expect(def.sql).toMatch(/INSUFFICIENT_BALANCE/);
  });

  it('fulfills via the shared process_payment_success path (atomic reuse, not a reimplementation)', () => {
    expect(def.sql).toMatch(/process_payment_success\s*\(/i);
    // Must NOT insert renewal_orders directly — that would duplicate the fragile path.
    expect(def.sql).not.toMatch(/INSERT\s+INTO\s+public\.renewal_orders/i);
  });

  it('is idempotent on a prior debit for the reference (no double-debit on retry)', () => {
    expect(def.sql).toMatch(/wallet_ledger\s+WHERE\s+reference\s*=\s*p_reference\s+AND\s+direction\s*=\s*'debit'/i);
  });
});

// ── Phase 3: wallet_admin_adjust ────────────────────────────────────────────
function latestAdminAdjust() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (parseInt(b.match(/^(\d+)/)?.[1] ?? '0', 10)) - (parseInt(a.match(/^(\d+)/)?.[1] ?? '0', 10)));
  for (const f of files) {
    const raw = readFileSync(join(migrationsDir, f), 'utf8');
    if (/FUNCTION\s+(public\.)?wallet_admin_adjust/i.test(raw)) return { file: f, sql: stripSqlComments(raw) };
  }
  return null;
}

describe('wallet_admin_adjust migration guard', () => {
  const def = latestAdminAdjust();

  it('a migration defining wallet_admin_adjust exists', () => {
    expect(def).not.toBeNull();
  });

  it('locks the wallet row before adjusting', () => {
    expect(def.sql).toMatch(/FOR\s+UPDATE/i);
  });

  it('cannot debit below zero', () => {
    expect(def.sql).toMatch(/balance_kobo\s*<\s*p_amount_kobo/i);
    expect(def.sql).toMatch(/INSUFFICIENT_BALANCE/);
  });

  it('records the admin and the reason in the ledger', () => {
    expect(def.sql).toMatch(/admin_id/i);
    expect(def.sql).toMatch(/p_note/i);
    expect(def.sql).toMatch(/'admin_adjustment'/i);
  });
});
