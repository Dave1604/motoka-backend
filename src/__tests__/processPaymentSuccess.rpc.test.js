import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Regression guard for the process_payment_success() RPC.
 *
 * This RPC is the SHARED order-creation path for BOTH Paystack and Monicredit
 * (webhook + verify). It has regressed twice around the same footgun:
 *
 *   - 025 fixed "column reference transaction_id is ambiguous" by using the
 *     constraint name in ON CONFLICT.
 *   - 036 kept the constraint-name form.
 *   - 051 REVERTED to `ON CONFLICT (transaction_id)`, reintroducing the
 *     ambiguity (the RETURNS TABLE output column `transaction_id` shadows the
 *     bare column in the conflict target) — every success-path call raised
 *     42702 and NO renewal order was created, on either gateway.
 *   - 065 restored the constraint-name form.
 *
 * A mocked unit test cannot catch this — the bug lives in SQL. This test reads
 * the *latest* migration that (re)defines the function and asserts the safe
 * form, so a future migration that reintroduces the ambiguous conflict target
 * fails CI instead of silently breaking payments in production.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

// Latest migration file (by numeric prefix) that contains a definition of the RPC.
function latestRpcDefinition() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = parseInt(a.match(/^(\d+)/)?.[1] ?? '0', 10);
      const nb = parseInt(b.match(/^(\d+)/)?.[1] ?? '0', 10);
      return nb - na; // descending
    });

  for (const f of files) {
    const raw = readFileSync(join(migrationsDir, f), 'utf8');
    if (/FUNCTION\s+(public\.)?process_payment_success/i.test(raw)) {
      return { file: f, sql: stripSqlComments(raw), raw };
    }
  }
  return null;
}

// Strip `--` line comments so we assert against executable SQL only — the
// migration header intentionally documents the bad form to explain the fix.
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

describe('process_payment_success RPC migration guard', () => {
  const def = latestRpcDefinition();

  it('a migration defining the RPC exists', () => {
    expect(def).not.toBeNull();
  });

  it('does NOT use the ambiguous bare-column ON CONFLICT (transaction_id)', () => {
    // The RETURNS TABLE output column is named transaction_id, so a bare-column
    // conflict target is ambiguous with renewal_orders.transaction_id (42702).
    const ambiguous = /ON\s+CONFLICT\s*\(\s*transaction_id\s*\)/i;
    expect(def.sql).not.toMatch(ambiguous);
  });

  it('uses the constraint-name ON CONFLICT (or an explicit variable_conflict pragma)', () => {
    const constraintForm = /ON\s+CONFLICT\s+ON\s+CONSTRAINT\s+renewal_orders_transaction_unique/i;
    const pragmaForm = /#variable_conflict\s+use_column/i;
    expect(constraintForm.test(def.sql) || pragmaForm.test(def.sql)).toBe(true);
  });

  it('still returns the (transaction_id, order_id, already_processed) shape the app maps', () => {
    // The controller reads result.transaction_id / order_id / already_processed.
    // Keep the output contract stable so a rename does not silently null them out.
    expect(def.sql).toMatch(/RETURNS\s+TABLE\s*\(/i);
    expect(def.sql).toMatch(/transaction_id\s+BIGINT/i);
    expect(def.sql).toMatch(/order_id\s+BIGINT/i);
    expect(def.sql).toMatch(/already_processed\s+BOOLEAN/i);
  });
});
