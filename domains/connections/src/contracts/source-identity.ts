import { z } from 'zod';
import { ActorId } from '@docket/identity-access/ids';

/** Explicit workspace-wide decision for a source identity. */
export const ExternalActorResolve = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('match_existing'), actorId: ActorId }),
    z.object({
      action: z.literal('create_actor'),
      name: z.string().trim().min(1).max(120).optional(),
    }),
    z.object({ action: z.literal('unlink') }),
    z.object({ action: z.literal('skip') }),
    z.object({ action: z.literal('unignore') }),
  ])
  .and(z.object({ expectedUpdatedAt: z.string().optional() }));
/** Validated source identity resolution request. */
export type ExternalActorResolve = z.infer<typeof ExternalActorResolve>;

/** A suggested match with its observable matching evidence. */
export const ExternalActorCandidate = z.object({
  actorId: ActorId,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  reason: z.enum(['name', 'email', 'linked']),
});

/** Source attribution displayed alongside a native person reference. */
export const SourcePersonReferenceOut = z.object({
  updatedAt: z.string().optional(),
  id: z.string(),
  externalActorId: z.string(),
  integrationId: z.string(),
  provider: z.string(),
  externalId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  actorId: ActorId.nullable(),
  canonicalDisplayName: z.string().nullable().optional(),
  canonicalAvatarUrl: z.string().nullable().optional(),
  field: z.string(),
});
/** Source attribution API representation. */
export type SourcePersonReferenceOut = z.infer<typeof SourcePersonReferenceOut>;

/**
 * Body for manually linking or unlinking an `external_actor` mapping.
 *
 * @remarks
 * `actorId` is a required key (never omitted) so the intent is always explicit: a string
 * links (and marks `matchedBy: 'manual'`, immune to future email re-matching), `null` unlinks
 * (and retains `matchedBy: 'manual'`, preventing automatic rematching).
 *
 * Either way `ignoredAt` is cleared: touching a mapping at all is a decision that supersedes an
 * earlier "don't sync them", and leaving the exclusion behind would keep the row immune to the
 * re-matching this route's own contract promises.
 */
export const ExternalActorPatch = z
  .object({
    actorId: ActorId.nullable().describe(
      "Set to a Docket Actor id to link manually — the actor MUST belong to the caller's org (404 `Actor not found` otherwise); the row is marked `matchedBy: 'manual'` and survives future email re-syncs untouched. Set to `null` to deliberately unlink. The manual decision survives future syncs. Both clear `ignoredAt`.",
    ),
  })
  .meta({
    id: 'ExternalActorPatch',
    description: 'Manually link or unlink an external-actor identity mapping.',
  });
/** Validated external-actor patch body. */
export type ExternalActorPatch = z.infer<typeof ExternalActorPatch>;
