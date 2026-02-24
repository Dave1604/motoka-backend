/**
 * Monicredit payment integration — public API surface.
 *
 * Consumers must import from this module rather than referencing internal
 * files directly. Internal organisation may change; this barrel is the
 * stable contract. The three layers exposed here are:
 *
 *   monicredit.service   — Raw HTTP client, MonicreditError, key accessors
 *   MonicreditAdapter    — Business-logic orchestration (init + verify flows)
 *   MonicreditNormalizer — Response shape normalisation and currency conversion
 */

export * from './monicredit.service.js';
export { MonicreditAdapter } from './monicredit.adapter.js';
export { MonicreditNormalizer } from './monicredit.normalizer.js';
