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
    subjectType: CommentSubjectType,
    subjectId: z.string().min(1),
  })
  .meta({ id: 'CommentListQuery', description: 'List comments for a subject.' });
/** Validated comment-list query value. */
export type CommentListQuery = z.infer<typeof CommentListQuery>;

/** Body for creating a Comment (authorId comes from the actor context, never the body). */
export const CommentCreate = z
  .object({
    subjectType: CommentSubjectType,
    subjectId: z.string().min(1),
    body: z.string().min(1),
    parentCommentId: CommentId.optional(),
  })
  .meta({ id: 'CommentCreate', description: 'Create a comment on a subject.' });
/** Validated comment-create body. */
export type CommentCreate = z.infer<typeof CommentCreate>;

/** Body for updating a Comment (only the body is editable; sets `editedAt`). */
export const CommentUpdate = z
  .object({
    body: z.string().min(1),
  })
  .meta({ id: 'CommentUpdate', description: 'Edit a comment body.' });
/** Validated comment-update body. */
export type CommentUpdate = z.infer<typeof CommentUpdate>;

/** Full comment representation returned by reads. */
export const CommentOut = z
  .object({
    id: CommentId,
    organizationId: OrganizationId,
    authorId: ActorId.nullable().optional(),
    subjectType: CommentSubjectType,
    subjectId: z.string(),
    body: z.string(),
    parentCommentId: CommentId.nullable().optional(),
    editedAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'CommentOut', description: 'A comment.' });
/** Comment representation value. */
export type CommentOut = z.infer<typeof CommentOut>;

/** Acknowledgement returned when a Comment is deleted. */
export const CommentRemoved = z
  .object({
    id: CommentId,
    removed: z.literal(true),
  })
  .meta({ id: 'CommentRemoved', description: 'A deleted-comment acknowledgement.' });
/** Removal acknowledgement value. */
export type CommentRemoved = z.infer<typeof CommentRemoved>;
