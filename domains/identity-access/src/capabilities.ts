import { z } from 'zod';

/** The five capability levels, ordered from least to most authority. */
export const Capability = z
  .enum(['view', 'comment', 'contribute', 'assign', 'manage'])
  .describe(
    'The capability ladder used for explicit grants. Higher levels satisfy lower required levels.',
  );

/** A single capability level. */
export type Capability = z.infer<typeof Capability>;

/** Compatibility name for a capability granted by a role or explicit grant. */
export const GrantCapability = Capability;

/** Ascending rank for each capability level. */
export const CAPABILITY_RANK = {
  view: 0,
  comment: 1,
  contribute: 2,
  assign: 3,
  manage: 4,
} as const satisfies Record<Capability, number>;

/**
 * Determines whether a held capability satisfies a required capability.
 *
 * @param held - The effective capability held by a principal.
 * @param required - The capability required by an operation.
 * @returns Whether the held capability has an equal or greater rank.
 */
export function satisfies(held: Capability, required: Capability): boolean {
  return CAPABILITY_RANK[held] >= CAPABILITY_RANK[required];
}

/**
 * Finds the highest capability in a collection.
 *
 * @param capabilities - Candidate capabilities to compare.
 * @returns The highest capability, or `null` when none are present.
 */
export function strongestCapability(capabilities: Iterable<Capability>): Capability | null {
  let strongest: Capability | null = null;

  for (const capability of capabilities) {
    if (strongest === null || CAPABILITY_RANK[capability] > CAPABILITY_RANK[strongest]) {
      strongest = capability;
    }
  }

  return strongest;
}
