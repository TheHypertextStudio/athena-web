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
  return formatCost(microsPerMillionUnits);
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
