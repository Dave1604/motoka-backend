/**
 * Amount Validation Service
 * 
 * Validates payment amounts to ensure financial integrity by detecting
 * discrepancies between expected and actual payment amounts. Throws
 * AmountValidationError for mismatches exceeding the configured tolerance.
 * 
 * This service implements blocking validation as part of Phase 2 remediation
 * to prevent payments with incorrect amounts from being processed.
 */

/**
 * Custom error for amount validation failures
 */
export class AmountValidationError extends Error {
  constructor(message, expectedAmount, actualAmount, difference, tolerance) {
    super(message);
    this.name = 'AmountValidationError';
    this.expectedAmount = expectedAmount;
    this.actualAmount = actualAmount;
    this.difference = difference;
    this.tolerance = tolerance;
  }
}

/**
 * Validates that the actual payment amount matches the expected amount
 * within the specified tolerance.
 * 
 * @param {number} expectedAmount - Expected amount in kobo
 * @param {number} actualAmount - Actual amount received in kobo
 * @param {number} tolerance - Maximum allowed difference in kobo (default: 1)
 * @returns {void}
 * @throws {AmountValidationError} If difference exceeds tolerance
 */
export function validatePaymentAmount(expectedAmount, actualAmount, tolerance = 1) {
  if (typeof expectedAmount !== 'number' || typeof actualAmount !== 'number') {
    throw new AmountValidationError(
      'Amount validation requires numeric values',
      expectedAmount,
      actualAmount,
      null,
      tolerance
    );
  }

  if (expectedAmount < 0 || actualAmount < 0) {
    throw new AmountValidationError(
      'Amounts must be non-negative',
      expectedAmount,
      actualAmount,
      null,
      tolerance
    );
  }

  const difference = Math.abs(actualAmount - expectedAmount);

  if (difference > tolerance) {
    throw new AmountValidationError(
      `Payment amount mismatch: expected ${expectedAmount} kobo (${expectedAmount / 100} NGN), ` +
      `received ${actualAmount} kobo (${actualAmount / 100} NGN), ` +
      `difference ${difference} kobo (${difference / 100} NGN) exceeds tolerance of ${tolerance} kobo`,
      expectedAmount,
      actualAmount,
      difference,
      tolerance
    );
  }
}
