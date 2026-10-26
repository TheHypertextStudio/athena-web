/**
 * How the cost screens name resources and write money.
 *
 * @remarks
 * Costs arrive in millionths of a dollar so nothing is rounded before it reaches the screen. They
 * are written here, once, so the ranking, a person's detail and the price list agree on every digit.
 */
import { formatBytes } from '@docket/ui';

import type { AdminCostHolder, AdminCostLine } from './types';

/** The name a holder is listed under. */
export function holderName(holder: Pick<AdminCostHolder, 'kind' | 'name' | 'email'>): string {
  if (holder.kind === 'unattributed') return 'Unattributed';
  const fallback = holder.kind === 'workspace' ? 'Workspace' : 'Unknown person';
  return holder.name ?? holder.email ?? fallback;
}

/** The resources the ledger meters. */
export type CostResource = AdminCostLine['resource'];

/** What each metered resource is called. */
export const RESOURCE_LABEL: Readonly<Record<CostResource, string>> = {
  ai_input_tokens: 'AI input tokens',
  ai_output_tokens: 'AI output tokens',
  ai_cache_read_tokens: 'AI cache reads',
  ai_cache_write_tokens: 'AI cache writes',
  postgres_bytes: 'Database storage',
  object_bytes: 'File storage',
};

/** The unit each resource's quantity is measured in. */
const BYTE_RESOURCES: ReadonlySet<CostResource> = new Set(['postgres_bytes', 'object_bytes']);

const MICROS_PER_DOLLAR = 1_000_000;

/**
 * Write a cost in dollars.
 *
 * @param micros - Millionths of a dollar.
 * @returns the amount, with enough places that a small cost is not shown as zero.
 */
export function formatCost(micros: number): string {
  const dollars = micros / MICROS_PER_DOLLAR;
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: dollars !== 0 && Math.abs(dollars) < 0.01 ? 4 : 2,
  });
}

/**
 * Write a cost that may be missing a price.
 *
 * @param micros - Priced cost in millionths of a dollar.
 * @param hasUnpriced - Whether some usage had no price, so the figure is a floor.
 * @returns the amount, marked as a minimum when it is not the whole cost.
 */
export function formatCostFloor(micros: number, hasUnpriced: boolean): string {
  return hasUnpriced ? `${formatCost(micros)}+` : formatCost(micros);
}

/**
 * Write a quantity in the unit its resource uses.
 *
 * @param resource - The metered resource.
 * @param quantity - Units consumed or held.
 * @returns bytes for storage, and a plain count for tokens.
 */
export function formatQuantity(resource: CostResource, quantity: number): string {
  return BYTE_RESOURCES.has(resource)
    ? formatBytes(quantity)
    : Math.round(quantity).toLocaleString();
}

/**
 * Write a price per million units in dollars.
 *
 * @param microsPerMillionUnits - The stored price.
 * @returns the price per million units.
 */
export function formatRate(microsPerMillionUnits: number): string {
  return (microsPerMillionUnits / MICROS_PER_DOLLAR).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** A month an operator can pick: its `YYYY-MM` value and the name shown for it. */
export interface MonthOption {
  /** The UTC month, `YYYY-MM`. */
  readonly value: string;
  /** The month written for a person, e.g. `October 2026`. */
  readonly label: string;
}

/**
 * The most recent UTC months, newest first.
 *
 * @param now - The instant the list is counted back from.
 * @param count - How many months to list, including the current one.
 * @returns one option per month.
 */
export function recentMonths(now: Date, count: number): MonthOption[] {
  return Array.from({ length: count }, (_, back) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return {
      value: month.toISOString().slice(0, 7),
      label: month.toLocaleDateString(undefined, {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
      }),
    };
  });
}

/**
 * Write the day a price starts applying.
 *
 * @remarks
 * Prices start on a UTC day, so the date is written in UTC; a local time of day would move the day
 * for anyone west of Greenwich.
 *
 * @param iso - The start instant, ISO-8601.
 * @returns the calendar day, e.g. `Jan 1, 2026`.
 */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Convert dollars per million units, as an operator types them, to the stored price.
 *
 * @param dollars - The text entered.
 * @returns millionths of a dollar per million units, or `null` when the text is not a price.
 */
export function parseRate(dollars: string): number | null {
  const value = Number(dollars);
  if (dollars.trim() === '' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * MICROS_PER_DOLLAR);
}
