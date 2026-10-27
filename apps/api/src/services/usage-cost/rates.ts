/**
 * `@docket/api` — pricing for the usage ledger.
 *
 * @remarks
 * The ledger stores quantities; this module turns a quantity into money. It is pure so the rule that
 * decides which price applies is testable without a database.
 */
import type { UsageResource } from '@docket/db';

/** One row of the rate card, as the pricing rules read it. */
export interface RateRow {
  /** The metered resource the price is for. */
  readonly resource: UsageResource;
  /** A model, table or store; empty for the resource's general rate. */
  readonly dimension: string;
  /** Millionths of a US dollar per million units. */
  readonly microsPerMillionUnits: number;
  /** The first instant the price applies. */
  readonly effectiveFrom: Date;
}

const MICROS_PER_MILLION = 1_000_000n;

/** The UTC calendar date of an instant, as `YYYY-MM-DD`. */
function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Pick the price that applied to a resource on a day.
 *
 * @remarks
 * A rate applies from the UTC day it takes effect. A rate for the exact dimension beats the
 * resource's general rate, but only while it is in effect: a dimension-specific rate that starts
 * later does not hide the general rate that applied before it.
 *
 * @param rates - Every rate on the card.
 * @param resource - The metered resource.
 * @param dimension - The model, table or store the usage belongs to.
 * @param day - The UTC day, `YYYY-MM-DD`.
 * @returns the applicable rate, or `undefined` when the quantity is unpriced.
 */
export function resolveRate(
  rates: readonly RateRow[],
  resource: UsageResource,
  dimension: string,
  day: string,
): RateRow | undefined {
  const inEffect = rates.filter(
    (rate) =>
      rate.resource === resource &&
      (rate.dimension === dimension || rate.dimension === '') &&
      utcDay(rate.effectiveFrom) <= day,
  );
  const latest = (candidates: readonly RateRow[]): RateRow | undefined =>
    candidates.reduce<RateRow | undefined>(
      (best, rate) => (best && best.effectiveFrom >= rate.effectiveFrom ? best : rate),
      undefined,
    );
  const exact = latest(inEffect.filter((rate) => rate.dimension === dimension && dimension !== ''));
  if (dimension.startsWith('lattice:') && resource.startsWith('ai_')) return exact;
  return exact ?? latest(inEffect.filter((rate) => rate.dimension === ''));
}

/**
 * Convert a quantity to millionths of a US dollar.
 *
 * @remarks
 * Done in `bigint` because a month of byte-days times a per-million price passes the range in which
 * a double is exact.
 *
 * @param quantity - Units consumed.
 * @param microsPerMillionUnits - The price of a million units.
 * @returns the cost in millionths of a dollar, rounded to the nearest whole micro-dollar.
 */
export function costMicros(quantity: number, microsPerMillionUnits: number): number {
  const product = BigInt(Math.trunc(quantity)) * BigInt(Math.trunc(microsPerMillionUnits));
  return Number((product + MICROS_PER_MILLION / 2n) / MICROS_PER_MILLION);
}
