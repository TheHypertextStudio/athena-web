/**
 * `@docket/types` — Role slice DTOs.
 *
 * @remarks
 * A role is a named org-level capability bundle (flat {@link GrantCapability}[]).
 * The four system roles (`owner`/`admin`/`member`/`guest`) are seeded with
 * `isSystem = true`; their `key` is immutable.
 */
import { z } from 'zod';

import { GrantCapability, Visibility } from './capability';
import { OrganizationId, RoleId } from './primitives';

/** Body for creating a Role (organizationId comes from the path, never the body). */
export const RoleCreate = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    capabilities: z.array(GrantCapability).optional(),
    baseCapability: GrantCapability.nullable().optional(),
    defaultVisibility: Visibility.optional(),
  })
  .meta({ id: 'RoleCreate', description: 'Create a role within an organization.' });
/** Validated role-create body. */
export type RoleCreate = z.infer<typeof RoleCreate>;

/** Body for updating a Role (system roles keep their immutable `key`). */
export const RoleUpdate = z
  .object({
    name: z.string().min(1).optional(),
    capabilities: z.array(GrantCapability).optional(),
    baseCapability: GrantCapability.nullable().optional(),
    defaultVisibility: Visibility.optional(),
  })
  .meta({ id: 'RoleUpdate', description: 'Update a role.' });
/** Validated role-update body. */
export type RoleUpdate = z.infer<typeof RoleUpdate>;

/** Full role representation returned by reads. */
export const RoleOut = z
  .object({
    id: RoleId,
    organizationId: OrganizationId,
    key: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
    capabilities: z.array(GrantCapability),
    baseCapability: GrantCapability.nullable().optional(),
    defaultVisibility: Visibility,
    createdAt: z.string(),
  })
  .meta({ id: 'RoleOut', description: 'A role.' });
/** Role representation value. */
export type RoleOut = z.infer<typeof RoleOut>;
