/**
 * Helpers shared by the five composer draft codecs.
 *
 * @remarks
 * A composer holds its references as plain strings; the draft payload carries the domain's branded
 * ids. Crossing that line goes through `safeParse` rather than `parse`: serialization runs on
 * every keystroke inside a memo, and a value that fails the id format is dropped from the draft
 * rather than thrown from render.
 *
 * Hydration is where a stale reference is stopped. A draft can be reopened weeks later, in a
 * workspace whose members, projects, or labels have changed, so every reference is checked against
 * the roster the composer has loaded and anything missing becomes "not set". The create body is
 * built from the composer's state, so what hydration leaves out can never reach the create call.
 */
import type { ComposerTimeframe } from '@docket/work/composer-draft-contract';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';
import type { ZodType, output } from 'zod';

/** Brand one id for the wire, or drop it when it does not have the id format. */
export function brandId<S extends ZodType>(schema: S, value: string | null): output<S> | null {
  if (value === null) return null;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Brand a list of ids for the wire, dropping any that do not have the id format. */
export function brandIds<S extends ZodType>(schema: S, values: readonly string[]): output<S>[] {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A reference as the draft holds it, or null when the roster no longer lists it. */
export function inRoster(id: string | null | undefined, roster: readonly string[]): string | null {
  if (id === null || id === undefined) return null;
  return roster.includes(id) ? id : null;
}

/** The references the roster still lists, in the draft's order. */
export function allInRoster(
  ids: readonly string[] | undefined,
  roster: readonly string[],
): string[] {
  return (ids ?? []).filter((id) => roster.includes(id));
}

/** A planning date as the draft payload carries it. */
export function timeframeToWire(value: PlanningTimeframe | null): ComposerTimeframe | null {
  if (value === null) return null;
  return {
    date: value.date,
    resolution: value.resolution,
    fiscalYearStartMonth: value.fiscalYearStartMonth,
  };
}

/** A planning date as the composer holds it. */
export function timeframeFromWire(
  value: ComposerTimeframe | null | undefined,
): PlanningTimeframe | null {
  if (value === null || value === undefined) return null;
  return {
    date: value.date,
    resolution: value.resolution,
    fiscalYearStartMonth: value.fiscalYearStartMonth,
  };
}
