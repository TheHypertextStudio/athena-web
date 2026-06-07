/**
 * `@docket/types` — Update (status post) slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { ActorId, OrganizationId, UpdateId } from './primitives';

/** The subjects an Update can post status about (Project/Program/Initiative). */
export const UpdateSubjectType = z.enum(['project', 'program', 'initiative']);
/** Update subject-type value. */
export type UpdateSubjectType = z.infer<typeof UpdateSubjectType>;

/** Query params for listing Updates on one subject. */
export const UpdateListQuery = z
  .object({
    subjectType: UpdateSubjectType,
    subjectId: z.string().min(1),
  })
  .meta({ id: 'UpdateListQuery', description: 'List updates for a subject.' });
/** Validated update-list query value. */
export type UpdateListQuery = z.infer<typeof UpdateListQuery>;

/** Body for posting an Update; the latest health also sets the subject's current health. */
export const UpdateCreate = z
  .object({
    subjectType: UpdateSubjectType,
    subjectId: z.string().min(1),
    health: Health.optional(),
    body: z.string().min(1),
  })
  .meta({ id: 'UpdateCreate', description: 'Post a status update on a subject.' });
/** Validated update-create body. */
export type UpdateCreate = z.infer<typeof UpdateCreate>;

/** Full update representation returned by reads. */
export const UpdateOut = z
  .object({
    id: UpdateId,
    organizationId: OrganizationId,
    authorId: ActorId.nullable().optional(),
    subjectType: UpdateSubjectType,
    subjectId: z.string(),
    health: Health.nullable().optional(),
    body: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'UpdateOut', description: 'A status update.' });
/** Update representation value. */
export type UpdateOut = z.infer<typeof UpdateOut>;
