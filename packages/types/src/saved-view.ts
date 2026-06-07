/**
 * `@docket/types` — Saved View slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, SavedViewId, TeamId } from './primitives';

/** A saved view's sharing scope. */
export const ViewScope = z.enum(['personal', 'team', 'organization']);
/** View scope value. */
export type ViewScope = z.infer<typeof ViewScope>;

/** One predicate in a saved view's filter set. */
export const ViewFilter = z
  .object({
    field: z.string(),
    op: z.enum(['eq', 'neq', 'in', 'nin', 'gt', 'lt', 'contains']),
    value: z.unknown(),
  })
  .meta({ id: 'ViewFilter', description: 'A saved-view filter predicate.' });
/** View filter value. */
export type ViewFilter = z.infer<typeof ViewFilter>;

/** A saved view's grouping config (group + optional sub-group). */
export const ViewGrouping = z
  .object({
    by: z.string(),
    subBy: z.string().optional(),
  })
  .meta({ id: 'ViewGrouping', description: 'A saved-view grouping config.' });
/** View grouping value. */
export type ViewGrouping = z.infer<typeof ViewGrouping>;

/** One sort term in a saved view. */
export const ViewSort = z
  .object({
    field: z.string(),
    order: z.enum(['asc', 'desc']),
  })
  .meta({ id: 'ViewSort', description: 'A saved-view sort term.' });
/** View sort value. */
export type ViewSort = z.infer<typeof ViewSort>;

/** Body for creating a Saved View (organizationId comes from the path, never the body). */
export const SavedViewCreate = z
  .object({
    name: z.string().min(1),
    scope: ViewScope.optional(),
    ownerActorId: ActorId.optional(),
    teamId: TeamId.optional(),
    filters: z.array(ViewFilter).optional(),
    grouping: ViewGrouping.nullable().optional(),
    sort: z.array(ViewSort).optional(),
  })
  .meta({ id: 'SavedViewCreate', description: 'Create a saved view within an organization.' });
/** Validated saved-view-create body. */
export type SavedViewCreate = z.infer<typeof SavedViewCreate>;

/** Body for updating a Saved View (all fields optional). */
export const SavedViewUpdate = z
  .object({
    name: z.string().min(1).optional(),
    scope: ViewScope.optional(),
    ownerActorId: ActorId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    filters: z.array(ViewFilter).optional(),
    grouping: ViewGrouping.nullable().optional(),
    sort: z.array(ViewSort).optional(),
  })
  .meta({ id: 'SavedViewUpdate', description: 'Update a saved view.' });
/** Validated saved-view-update body. */
export type SavedViewUpdate = z.infer<typeof SavedViewUpdate>;

/** Full saved-view representation returned by reads. */
export const SavedViewOut = z
  .object({
    id: SavedViewId,
    organizationId: OrganizationId,
    name: z.string(),
    scope: ViewScope,
    ownerActorId: ActorId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    filters: z.array(ViewFilter),
    grouping: ViewGrouping.nullable().optional(),
    sort: z.array(ViewSort),
    createdAt: z.string(),
  })
  .meta({ id: 'SavedViewOut', description: 'A saved view.' });
/** Saved-view representation value. */
export type SavedViewOut = z.infer<typeof SavedViewOut>;
