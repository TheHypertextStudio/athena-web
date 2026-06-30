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
    subjectType: UpdateSubjectType.describe(
      "Kind of subject to read updates for: 'project' | 'program' | 'initiative'.",
    ),
    subjectId: z.string().min(1).describe('Id of the subject whose updates to list. Required.'),
  })
  .meta({ id: 'UpdateListQuery', description: 'List updates for a subject.' });
/** Validated update-list query value. */
export type UpdateListQuery = z.infer<typeof UpdateListQuery>;

/** Body for posting an Update; the latest health also sets the subject's current health. */
export const UpdateCreate = z
  .object({
    subjectType: UpdateSubjectType.describe(
      "Kind of subject to post about: 'project' | 'program' | 'initiative'.",
    ),
    subjectId: z.string().min(1).describe('Id of the subject to post the update on. Required.'),
    health: Health.optional().describe(
      "Optional health signal: 'on_track' | 'at_risk' | 'off_track'. When set, it also overwrites the subject's current health (latest health-bearing update wins). Omit to post a narrative-only update that leaves subject health untouched.",
    ),
    body: z.string().min(1).describe('The update narrative (markdown). Required, non-empty.'),
  })
  .meta({ id: 'UpdateCreate', description: 'Post a status update on a subject.' });
/** Validated update-create body. */
export type UpdateCreate = z.infer<typeof UpdateCreate>;

/** Full update representation returned by reads. */
export const UpdateOut = z
  .object({
    id: UpdateId.describe('Opaque update id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    authorId: ActorId.nullable()
      .optional()
      .describe('Actor who posted the update; null if the author record is gone.'),
    subjectType: UpdateSubjectType.describe(
      "Kind of subject: 'project' | 'program' | 'initiative'.",
    ),
    subjectId: z.string().describe('Id of the subject the update is about.'),
    health: Health.nullable()
      .optional()
      .describe(
        "Health this update reported ('on_track' | 'at_risk' | 'off_track'); null when the post set no health.",
      ),
    body: z.string().describe('The update narrative (markdown).'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601); updates list newest-first.'),
  })
  .meta({ id: 'UpdateOut', description: 'A status update.' });
/** Update representation value. */
export type UpdateOut = z.infer<typeof UpdateOut>;

/** Acknowledgement returned when an Update is deleted (the subject health is recomputed). */
export const UpdateRemoved = z
  .object({
    id: UpdateId.describe('Id of the deleted update.'),
    removed: z
      .literal(true)
      .describe(
        'Always `true`; confirms deletion. The subject’s health was recomputed from remaining updates.',
      ),
  })
  .meta({ id: 'UpdateRemoved', description: 'A deleted-update acknowledgement.' });
/** Removal acknowledgement value. */
export type UpdateRemoved = z.infer<typeof UpdateRemoved>;
