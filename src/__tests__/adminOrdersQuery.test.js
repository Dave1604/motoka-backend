import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * PostgREST reads an embed as alias:relation!hint. Written as alias!hint:relation
 * it refuses to parse the whole select, so the admin Orders page lists nothing.
 * A mocked client accepts any string, so this checks the query text itself.
 */
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'controllers', 'admin.controller.js'),
  'utf8'
);

describe('admin orders payment filter', () => {
  it('writes the inner join hint after the relation', () => {
    expect(source).toContain('payment_transactions:transaction_id!inner (');
    expect(source).not.toMatch(/\w+!inner:\w+/);
  });
});
