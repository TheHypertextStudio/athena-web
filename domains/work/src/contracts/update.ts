/**
 * `domain packages` — Update (status post) slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { InitiativeSubjectRef, ProjectSubjectRef, ProgramSubjectRef } from './subject-ref';
import { ActorId, OrganizationId } from '@docket/identity-access/ids';
import { UpdateId } from '../ids';

/** The subjects an Update can post status about (Project/Program/Initiative). */
export const UpdateSubjectType = z.enum(['project', 'program', 'initiative']);
/** Update subject-type value. */
export type UpdateSubjectType = z.infer<typeof UpdateSubjectType>;

/** Query params for listing Updates on one subject. */
const UpdateSubjectRef = z.discriminatedUnion('subjectType', [
  ProjectSubjectRef,
  ProgramSubjectRef,
  InitiativeSubjectRef,
]);

/** Query parameters for listing Updates on one validated subject. */
export const UpdateListQuery = UpdateSubjectRef.meta({
  id: 'UpdateListQuery',
  description: 'List updates for a subject.',
});
/** Validated update-list query value. */
export type UpdateListQuery = z.infer<typeof UpdateListQuery>;

/** Body for posting an Update; the latest health also sets the subject's current health. */
const updateCreateFields = {
  health: Health.optional().describe(
    "Optional health signal: 'on_track' | 'at_risk' | 'off_track'. When set, it also overwrites the subject's current health (latest health-bearing update wins). Omit to post a narrative-only update that leaves subject health untouched.",
  ),
  body: z.string().min(1).describe('The update narrative (markdown). Required, non-empty.'),
};

/** Body for posting an Update on one validated subject. */
export const UpdateCreate = z
  .discriminatedUnion('subjectType', [
    ProjectSubjectRef.extend(updateCreateFields),
    ProgramSubjectRef.extend(updateCreateFields),
    InitiativeSubjectRef.extend(updateCreateFields),
  ])
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

/** A named author shown beside one deferred update without shipping an organization roster. */
export const UpdateAuthorReference = z
  .object({
    actorId: ActorId,
    displayName: z.string(),
    avatar: z.string().nullable(),
    kind: z.enum(['human', 'agent', 'team']),
  })
  .strict()
  .meta({ id: 'UpdateAuthorReference', description: 'Named author for a deferred update feed.' });
/** A named author for a deferred update feed. */
export type UpdateAuthorReference = z.infer<typeof UpdateAuthorReference>;

/** A bounded update section with only the actors referenced by its update rows. */
export const UpdateFeed = z
  .object({ items: z.array(UpdateOut), authors: z.array(UpdateAuthorReference) })
  .strict()
  .meta({ id: 'UpdateFeed', description: 'Deferred update rows and their referenced authors.' });
/** A bounded update section and its named authors. */
export type UpdateFeed = z.infer<typeof UpdateFeed>;

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
