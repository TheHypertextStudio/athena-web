/**
 * `@docket/types` — Comment slice DTOs.
 */
import { z } from 'zod';

import { ActorId, CommentId, OrganizationId } from './primitives';

/** The polymorphic subject kinds a Comment can attach to. */
export const CommentSubjectType = z.enum(['task', 'project', 'program', 'initiative', 'cycle']);
/** Comment subject-type value. */
export type CommentSubjectType = z.infer<typeof CommentSubjectType>;

/** Query params for listing Comments on one polymorphic subject. */
export const CommentListQuery = z
  .object({
    subjectType: CommentSubjectType.describe(
      "Kind of subject to read comments for: 'task' | 'project' | 'program' | 'initiative' | 'cycle'.",
    ),
    subjectId: z
      .string()
      .min(1)
      .describe('Id of the subject whose comment thread to list. Required.'),
  })
  .meta({ id: 'CommentListQuery', description: 'List comments for a subject.' });
/** Validated comment-list query value. */
export type CommentListQuery = z.infer<typeof CommentListQuery>;

/** Body for creating a Comment (authorId comes from the actor context, never the body). */
export const CommentCreate = z
  .object({
    subjectType: CommentSubjectType.describe(
      "Kind of subject to comment on: 'task' | 'project' | 'program' | 'initiative' | 'cycle'.",
    ),
    subjectId: z.string().min(1).describe('Id of the subject the comment attaches to. Required.'),
    body: z.string().min(1).describe('Comment text (markdown). Required, non-empty.'),
    parentCommentId: CommentId.optional().describe(
      'Set to reply to an existing comment. The parent must be a ROOT comment on the SAME subject and org — replies are single-level (no replies to replies). Omit for a root comment.',
    ),
  })
  .meta({ id: 'CommentCreate', description: 'Create a comment on a subject.' });
/** Validated comment-create body. */
export type CommentCreate = z.infer<typeof CommentCreate>;

/** Body for updating a Comment (only the body is editable; sets `editedAt`). */
export const CommentUpdate = z
  .object({
    body: z
      .string()
      .min(1)
      .describe(
        'Replacement comment text (markdown). Required, non-empty. The only editable field; editing stamps `editedAt`.',
      ),
  })
  .meta({ id: 'CommentUpdate', description: 'Edit a comment body.' });
/** Validated comment-update body. */
export type CommentUpdate = z.infer<typeof CommentUpdate>;

/** Full comment representation returned by reads. */
export const CommentOut = z
  .object({
    id: CommentId.describe('Opaque comment id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    authorId: ActorId.nullable()
      .optional()
      .describe(
        'Actor who wrote the comment (a human or an agent posting as its Actor); null if the author record is gone.',
      ),
    subjectType: CommentSubjectType.describe(
      "Kind of subject the comment is on: 'task' | 'project' | 'program' | 'initiative' | 'cycle'.",
    ),
    subjectId: z.string().describe('Id of the subject the comment is attached to.'),
    body: z.string().describe('Comment text (markdown).'),
    parentCommentId: CommentId.nullable()
      .optional()
      .describe('Parent comment id when this is a reply; null for a root comment.'),
    editedAt: z
      .string()
      .nullable()
      .optional()
      .describe('When the body was last edited (ISO 8601); null if never edited.'),
    createdAt: z
      .string()
      .describe('Creation timestamp (ISO 8601); the thread sort key (ascending).'),
  })
  .meta({ id: 'CommentOut', description: 'A comment.' });
/** Comment representation value. */
export type CommentOut = z.infer<typeof CommentOut>;

/** Acknowledgement returned when a Comment is deleted. */
export const CommentRemoved = z
  .object({
    id: CommentId.describe('Id of the deleted comment.'),
    removed: z
      .literal(true)
      .describe(
        'Always `true`; confirms the comment was deleted. Its replies were re-parented to root.',
      ),
  })
  .meta({ id: 'CommentRemoved', description: 'A deleted-comment acknowledgement.' });
/** Removal acknowledgement value. */
export type CommentRemoved = z.infer<typeof CommentRemoved>;
