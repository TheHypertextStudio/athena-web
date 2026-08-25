/** Inputs used to calculate one mid-period discount credit in currency minor units. */
export interface UnusedPeriodCreditInput {
  /** Recurring invoice-line amount before tax and discounts, in currency minor units. */
  readonly recurringAmount: number;
  /** Approved integer percentage from 1 through 90. */
  readonly percentOff: number;
  /** Inclusive start of the recurring invoice-line service period. */
  readonly periodStartsAt: Date;
  /** Exclusive end of the recurring invoice-line service period. */
  readonly periodEndsAt: Date;
  /** Instant finance approved the discount. */
  readonly approvedAt: Date;
}

/**
 * Calculate the base credit for an approved mid-period discount.
 *
 * @param input - The invoice-line amount, service period, approval instant, and approved rate.
 * @returns The base credit in currency minor units, rounded to the nearest unit.
 * @throws {RangeError} When the amount, percentage, or service period is invalid.
 */
export function calculateUnusedPeriodCredit(input: UnusedPeriodCreditInput): number {
  if (!Number.isSafeInteger(input.recurringAmount) || input.recurringAmount < 0) {
    throw new RangeError('recurringAmount must be a non-negative currency minor-unit integer');
  }
  if (!Number.isInteger(input.percentOff) || input.percentOff < 1 || input.percentOff > 90) {
    throw new RangeError('percentOff must be an integer from 1 through 90');
  }

  const periodStart = input.periodStartsAt.getTime();
  const periodEnd = input.periodEndsAt.getTime();
  const approvedAt = input.approvedAt.getTime();
  if (![periodStart, periodEnd, approvedAt].every(Number.isFinite) || periodEnd <= periodStart) {
    throw new RangeError('period must have finite dates and end after it starts');
  }

  const unusedStartsAt = Math.max(periodStart, approvedAt);
  if (unusedStartsAt >= periodEnd || input.recurringAmount === 0) return 0;

  const unusedShare = (periodEnd - unusedStartsAt) / (periodEnd - periodStart);
  return Math.round(input.recurringAmount * unusedShare * (input.percentOff / 100));
}
