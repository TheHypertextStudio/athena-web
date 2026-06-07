/**
 * `@docket/types` — Grant slice DTOs.
 *
 * @remarks
 * A grant binds a subject (an Actor or a Role) to a resource node in the containment
 * tree, conferring a flat {@link GrantCapability}[]. Only `allow` grants are written
 * (the `deny` effect exists in the schema but is gated off); the PUT endpoint upserts
 * by `(subjectKind, subjectId, resourceKind, resourceId, effect)`.
 */
import { z } from 'zod';

import { GrantCapability, Visibility } from './capability';
import { GrantId, OrganizationId } from './primitives';

/** A grant's subject discriminator (an Actor or a Role). */
export const GrantSubjectKind = z.enum(['actor', 'role']);
/** Grant subject-kind value. */
export type GrantSubjectKind = z.infer<typeof GrantSubjectKind>;

/** A containment node kind a grant can target. */
export const GrantResourceKind = z.enum([
  'organization',
  'team',
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
]);
/** Grant resource-kind value. */
export type GrantResourceKind = z.infer<typeof GrantResourceKind>;

/** Body for upserting a Grant (organizationId comes from the path; effect is `allow`). */
export const GrantUpsert = z
  .object({
    subjectKind: GrantSubjectKind,
    subjectId: z.string().min(1),
    resourceKind: GrantResourceKind,
    resourceId: z.string().min(1),
    capabilities: z.array(GrantCapability),
    cascades: z.boolean().optional(),
    visibilityOverride: Visibility.nullable().optional(),
    visibility: Visibility.optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .meta({ id: 'GrantUpsert', description: 'Upsert a capability grant on a resource.' });
/** Validated grant-upsert body. */
export type GrantUpsert = z.infer<typeof GrantUpsert>;

/** Full grant representation returned by reads. */
export const GrantOut = z
  .object({
    id: GrantId,
    organizationId: OrganizationId,
    subjectKind: GrantSubjectKind,
    subjectId: z.string(),
    resourceKind: GrantResourceKind,
    resourceId: z.string(),
    capabilities: z.array(GrantCapability),
    effect: z.enum(['allow', 'deny']),
    cascades: z.boolean(),
    visibilityOverride: Visibility.nullable().optional(),
    visibility: Visibility,
    expiresAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'GrantOut', description: 'A capability grant.' });
/** Grant representation value. */
export type GrantOut = z.infer<typeof GrantOut>;
