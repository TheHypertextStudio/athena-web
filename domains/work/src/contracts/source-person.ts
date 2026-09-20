import { z } from 'zod';
import { ActorId } from '@docket/identity-access/ids';

/** Provider attribution retained independently of a canonical workspace person. */
export const SourcePersonReference = z.object({
  id: z.string(),
  updatedAt: z.string().optional(),
  externalActorId: z.string(),
  integrationId: z.string(),
  provider: z.string(),
  externalId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  canonicalDisplayName: z.string().nullable().optional(),
  canonicalAvatarUrl: z.string().nullable().optional(),
  actorId: ActorId.nullable(),
  field: z.string(),
});
