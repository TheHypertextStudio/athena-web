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
export const GrantSubjectKind = z
  .enum(['actor', 'role'])
  .describe(
    "What the grant's `subjectId` points at: 'actor' (an individual human or agent Actor — an override/addition for one identity) or 'role' (every holder of that org role — how a role's org-wide baseline is stored).",
  );
/** Grant subject-kind value. */
export type GrantSubjectKind = z.infer<typeof GrantSubjectKind>;

/** A containment node kind a grant can target. */
export const GrantResourceKind = z
  .enum(['organization', 'team', 'initiative', 'program', 'project', 'cycle', 'task'])
  .describe(
    "The kind of resource node the grant targets in the containment tree — one of 'organization' | 'team' | 'initiative' | 'program' | 'project' | 'cycle' | 'task'. Authorization cascades down containment edges (Org › Team/Program › Project › Task); a grant at a node can apply to its whole subtree (see `cascades`).",
  );
/** Grant resource-kind value. */
export type GrantResourceKind = z.infer<typeof GrantResourceKind>;

/** Body for upserting a Grant (organizationId comes from the path; effect is `allow`). */
export const GrantUpsert = z
  .object({
    subjectKind: GrantSubjectKind.describe(
      "Whether the grant's subject is an individual 'actor' or a 'role' bundle. Together with `subjectId` and the resource tuple it forms the upsert key.",
    ),
    subjectId: z
      .string()
      .min(1)
      .describe(
        "Id of the subject: an Actor id when `subjectKind = 'actor'`, or a Role id when `subjectKind = 'role'`.",
      ),
    resourceKind: GrantResourceKind.describe(
      'The kind of containment node the grant is attached to (organization/team/program/project/task/…).',
    ),
    resourceId: z
      .string()
      .min(1)
      .describe(
        'Id of the specific resource instance the grant targets (e.g. a particular project id). For an org-root grant this is the organization id.',
      ),
    capabilities: z
      .array(GrantCapability)
      .describe(
        "The capabilities to confer at this resource, each one of 'view' < 'comment' < 'contribute' < 'assign' < 'manage' (ascending; higher implies all lower, resolved by max rank). Cannot exceed the writer's own max held capability (no self-escalation — a violation is rejected).",
      ),
    cascades: z
      .boolean()
      .optional()
      .describe(
        "When true (default), the grant applies to the named resource AND its entire containment subtree, overridable by a more-specific grant lower down. When false it pins to exactly that one resource (e.g. 'view this single task but nothing else in the project'). Defaults to true.",
      ),
    visibilityOverride: Visibility.nullable()
      .optional()
      .describe(
        "Per-resource visibility flip applied at this node — 'public' or 'private' — overriding the resource's inherited/stored visibility (most-specific override wins). Null (default) means inherit. Powers e.g. making one project public inside an otherwise members-only context.",
      ),
    visibility: Visibility.optional().describe(
      'Optional stored visibility to set on the grant row itself. Distinct from `visibilityOverride`: omit unless you specifically need to set the persisted visibility column.',
    ),
    expiresAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe(
        'Optional ISO-8601 expiry. Once `< now` the grant becomes inert — filtered out by the resolver — which powers time-boxed access such as temporary guest grants. Null (default) means it never expires.',
      ),
  })
  .meta({ id: 'GrantUpsert', description: 'Upsert a capability grant on a resource.' });
/** Validated grant-upsert body. */
export type GrantUpsert = z.infer<typeof GrantUpsert>;

/** Full grant representation returned by reads. */
export const GrantOut = z
  .object({
    id: GrantId.describe(
      'Stable ULID identifier of the grant. Used to delete it (`DELETE /:grantId`).',
    ),
    organizationId: OrganizationId.describe('The organization this grant belongs to.'),
    subjectKind: GrantSubjectKind.describe(
      "Whether the subject is an individual 'actor' or a 'role' bundle.",
    ),
    subjectId: z
      .string()
      .describe('Id of the subject — an Actor id or a Role id, per `subjectKind`.'),
    resourceKind: GrantResourceKind.describe(
      'The kind of containment node the grant is attached to.',
    ),
    resourceId: z.string().describe('Id of the specific resource instance the grant targets.'),
    capabilities: z
      .array(GrantCapability)
      .describe(
        "The conferred capabilities, each 'view' < 'comment' < 'contribute' < 'assign' < 'manage'; the resolver evaluates at the set's max rank.",
      ),
    effect: z
      .enum(['allow', 'deny'])
      .describe(
        "Whether the grant adds ('allow') or subtracts ('deny') capability. The schema models both, but the API only ever writes 'allow' grants — 'deny' is gated off at the write endpoint.",
      ),
    cascades: z
      .boolean()
      .describe(
        'True when the grant applies to the resource AND its whole containment subtree (overridable lower); false when pinned to exactly that one resource.',
      ),
    visibilityOverride: Visibility.nullable()
      .optional()
      .describe(
        "Per-resource visibility flip ('public'/'private') applied at this node, or null to inherit. Most-specific override wins when resolving a resource's effective visibility.",
      ),
    visibility: Visibility.describe("The grant row's stored visibility ('public' | 'private')."),
    expiresAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO-8601 expiry; once past, the grant is inert and ignored by the resolver. Null when the grant never expires.',
      ),
    createdAt: z.string().describe('ISO-8601 timestamp of when the grant was created.'),
  })
  .meta({ id: 'GrantOut', description: 'A capability grant.' });
/** Grant representation value. */
export type GrantOut = z.infer<typeof GrantOut>;
