/** The three outcomes that a task-scoped destination review may return. */
import { z } from 'zod';

const ReviewReason = z.string().trim().min(1).max(1_000);

/** A bounded scope that limits a granted destination to an origin or path prefix. */
const WorkDestinationScopeOut = z
  .object({
    kind: z.enum(['origin', 'path_prefix']),
    value: z.string().min(1),
  })
  .strict();

/** The public result from one task-scoped destination review. */
export const WorkDestinationReviewOut = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('grant'),
      reason: ReviewReason,
      scope: WorkDestinationScopeOut,
    })
    .strict(),
  z
    .object({
      decision: z.literal('challenge'),
      reason: ReviewReason,
      question: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z.object({ decision: z.literal('deny'), reason: ReviewReason }).strict(),
]);

/** One valid task-scoped destination review result. */
export type WorkDestinationReviewOut = z.infer<typeof WorkDestinationReviewOut>;
