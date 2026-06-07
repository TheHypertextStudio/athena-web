/**
 * `@docket/types` — the flat capability model + shared work enums.
 *
 * @remarks
 * Capabilities are a single ordered literal set (NO CapabilityGrid). `satisfies`
 * implements the rank cascade used by the permission engine: a higher-ranked held
 * capability satisfies any lower-ranked requirement.
 */
import { z } from 'zod';

/** The five capabilities, lowest to highest privilege. */
export const Capability = z.enum(['view', 'comment', 'contribute', 'assign', 'manage']);
/** A single capability literal. */
export type Capability = z.infer<typeof Capability>;

/** Alias used by the grant/role schemas. */
export const GrantCapability = Capability;

/** Ascending privilege rank for each capability (higher satisfies lower). */
export const CAPABILITY_RANK: Record<Capability, number> = {
  view: 0,
  comment: 1,
  contribute: 2,
  assign: 3,
  manage: 4,
};

/**
 * Whether a held capability satisfies a required one (rank cascade).
 *
 * @param held - The capability the actor effectively holds.
 * @param required - The capability the operation requires.
 * @returns true when `held` ranks at or above `required`.
 */
export function satisfies(held: Capability, required: Capability): boolean {
  return CAPABILITY_RANK[held] >= CAPABILITY_RANK[required];
}

/** Resource visibility: public to org members, or private (grant-only). */
export const Visibility = z.enum(['public', 'private']);
/** Resource visibility value. */
export type Visibility = z.infer<typeof Visibility>;

/** Judgment-based health for Projects/Programs/Initiatives. */
export const Health = z.enum(['on_track', 'at_risk', 'off_track']);
/** Health value. */
export type Health = z.infer<typeof Health>;

/** Task priority. */
export const Priority = z.enum(['none', 'urgent', 'high', 'medium', 'low']);
/** Priority value. */
export type Priority = z.infer<typeof Priority>;
