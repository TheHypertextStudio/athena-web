/**
 * `@docket/api` — reading field values pulled from Notion into Docket column types.
 *
 * @remarks
 * Each reader returns `undefined` when the value is absent or a different kind, so a caller can
 * leave the Docket column alone rather than clear it on a value it did not read.
 */
import type { MirrorValue } from '@docket/connections/notion/mirror-values';

import { loadStatusSets, type ResolvedStatus } from '../lib/work-status';

/** Field values read from Notion, keyed by the catalog's field keys. */
export type PulledValues = Readonly<Record<string, MirrorValue>>;

/**
 * Read a `text`-kind value.
 *
 * @returns the text (`''` for an empty value), or undefined when absent or a different kind.
 */
export function pulledText(values: PulledValues, field: string): string | undefined {
  const value = values[field];
  if (value?.kind !== 'text') return undefined;
  return value.value ?? '';
}

/**
 * Read a `date`-kind value as a `Date`.
 *
 * @returns the date, null for an empty value, or undefined when absent or a different kind.
 */
export function pulledDate(values: PulledValues, field: string): Date | null | undefined {
  const value = values[field];
  if (value?.kind !== 'date') return undefined;
  return value.value === null ? null : new Date(value.value);
}

/**
 * Read a `number`-kind value.
 *
 * @returns the number, null for an empty value, or undefined when absent or a different kind.
 */
export function pulledNumber(values: PulledValues, field: string): number | null | undefined {
  const value = values[field];
  if (value?.kind !== 'number') return undefined;
  return value.value;
}

/**
 * Read an `option`-kind value, but only when it exactly matches one of Docket's own enum values.
 *
 * @remarks
 * A Notion select is free text, edited by whoever has access to the page. Docket's `priority`/
 * `status`/`health` columns are not — writing an unrecognized option name would either fail the
 * query or, worse, succeed with a value the rest of the product does not know how to render. An
 * unrecognized option is treated as "not read", the same as an absent property: the column keeps
 * whatever Docket already had, rather than being cleared or corrupted by a rename in Notion.
 *
 * @returns the matching enum value, or undefined.
 */
export function pulledEnumOption<T extends string>(
  values: PulledValues,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = values[field];
  if (value?.kind !== 'option' || value.value === null) return undefined;
  return (allowed as readonly string[]).includes(value.value) ? (value.value as T) : undefined;
}

/**
 * Read the `status` property as one of the workspace's own Project statuses.
 *
 * @remarks
 * A Project's status is workspace-defined rather than a fixed enum, so the pulled option is
 * matched against the workspace's Project set by key or display name, case-insensitively — the
 * same two spellings the write routes accept. An option naming no status in the set is treated as
 * "not read", exactly like an unrecognized `priority`/`health` option: the column keeps whatever
 * Docket already had.
 *
 * Returning the whole status is what lets the caller write the `status` key and the `status_id`
 * the composite foreign key holds it to, from one answer.
 *
 * @param orgId - The tenant whose Project set the option is read against.
 * @param values - Field values read from Notion, keyed by the catalog's field keys.
 * @returns the named status, or undefined when the property is absent, empty, or unrecognized.
 */
export async function pulledProjectStatus(
  orgId: string,
  values: PulledValues,
): Promise<ResolvedStatus | undefined> {
  const value = values['status'];
  if (value?.kind !== 'option' || value.value === null) return undefined;
  const needle = value.value.trim().toLowerCase();
  const sets = await loadStatusSets(orgId, { entityTypes: ['project'] });
  return sets
    .for('project')
    .find((status) => status.key.toLowerCase() === needle || status.name.toLowerCase() === needle);
}
