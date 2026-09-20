/**
 * `domain packages` — Role slice DTOs.
 *
 * @remarks
 * A role is a named org-level capability bundle (flat {@link GrantCapability}[]).
 * The four system roles (`owner`/`admin`/`member`/`guest`) are seeded with
 * `isSystem = true`; their `key` is immutable.
 */
import { z } from 'zod';

import { GrantCapability } from '@docket/identity-access/capabilities';
import { Visibility } from '@docket/work/capability-contract';
import { OrganizationId, RoleId } from '@docket/identity-access/ids';

/** Body for creating a Role (organizationId comes from the path, never the body). */
export const RoleCreate = z
  .object({
    key: z
      .string()
      .min(1)
      .describe(
        'Stable URL-safe identifier that is unique within the organization and cannot change after creation. The system roles reserve `owner`, `admin`, `member`, and `guest`.',
      ),
    name: z
      .string()
      .min(1)
      .describe('Human-readable display name for the role (honors the org vocabulary skin).'),
    capabilities: z
      .array(GrantCapability)
      .optional()
      .describe(
        "The role's capability bundle, each one of 'view' < 'comment' < 'contribute' < 'assign' < 'manage' (ascending privilege; a higher capability implies all lower ones, and the resolver collapses the set to its max rank). Defaults to an empty array when omitted.",
      ),
    baseCapability: GrantCapability.nullable()
      .optional()
      .describe(
        "The organization-wide capability granted by this role, or null for a role such as Guest that receives access only through explicit grants. It cannot exceed the creator's own capability. Defaults to null.",
      ),
    defaultVisibility: Visibility.optional().describe(
      "The role's default resource visibility — 'public' (members see all public work without a grant) or 'private' (grant-only, like Guest: sees nothing until an explicit grant). Governs the visibility fallback in the permission resolver. Defaults at the DB level when omitted.",
    ),
  })
  .meta({ id: 'RoleCreate', description: 'Create a role within an organization.' });
/** Validated role-create body. */
export type RoleCreate = z.infer<typeof RoleCreate>;

/** Body for updating a Role (system roles keep their immutable `key`). */
export const RoleUpdate = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "New display name for the role. Omit it to keep the current name. A role's key cannot be changed.",
      ),
    capabilities: z
      .array(GrantCapability)
      .optional()
      .describe(
        "Replace the role's capability bundle (each one of 'view' < 'comment' < 'contribute' < 'assign' < 'manage'). Setting this overwrites the whole array, not a merge. Optional; omit to leave unchanged. Cannot raise the role above the editor's own effective capability (no self-escalation).",
      ),
    baseCapability: GrantCapability.nullable()
      .optional()
      .describe(
        'Change the org-wide baseline this role confers (one of the five capabilities, or null to make it grant-only). Optional; omit to leave unchanged. Setting null clears the org-root baseline.',
      ),
    defaultVisibility: Visibility.optional().describe(
      "Change the role's default visibility — 'public' or 'private'. Optional; omit to leave unchanged.",
    ),
  })
  .meta({ id: 'RoleUpdate', description: 'Update a role.' });
/** Validated role-update body. */
export type RoleUpdate = z.infer<typeof RoleUpdate>;

/** Full role representation returned by reads. */
export const RoleOut = z
  .object({
    id: RoleId.describe('Stable ULID identifier of the role.'),
    organizationId: OrganizationId.describe('The organization this role belongs to.'),
    key: z
      .string()
      .describe(
        'Immutable, org-unique identifier for the role. The system roles use `owner`/`admin`/`member`/`guest`; custom roles use their chosen slug.',
      ),
    name: z.string().describe('Human-readable display name (honors the org vocabulary skin).'),
    isSystem: z
      .boolean()
      .describe(
        'True for the four seeded system roles (Owner/Admin/Member/Guest), which cannot be deleted and keep an immutable key. False for custom roles.',
      ),
    capabilities: z
      .array(GrantCapability)
      .describe(
        "The role's capability bundle, each one of 'view' < 'comment' < 'contribute' < 'assign' < 'manage' (ascending; higher implies all lower). The resolver evaluates the holder at the bundle's max rank.",
      ),
    baseCapability: GrantCapability.nullable()
      .optional()
      .describe(
        'The organization-wide capability granted by this role, or null for a role such as Guest that receives access only through explicit grants.',
      ),
    defaultVisibility: Visibility.describe(
      "The role's default resource visibility — 'public' (members see public work without a grant) or 'private' (grant-only). Drives the permission resolver's visibility fallback.",
    ),
    createdAt: z.string().describe('ISO-8601 timestamp of when the role was created.'),
  })
  .meta({ id: 'RoleOut', description: 'A role.' });
/** Role representation value. */
export type RoleOut = z.infer<typeof RoleOut>;
