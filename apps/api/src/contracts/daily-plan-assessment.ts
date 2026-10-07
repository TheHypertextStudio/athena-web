/** Bounded model output for a read-only review of a daily planning proposal. */
import { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { z } from 'zod';

/** One missing task that a person may review in the existing task composer. */
export const dailyPlanTaskSuggestion = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(240),
});
/** Model return tool input; the API fills project names from visible records. */
export const dailyPlanAssessmentReply = z
  .object({
    assessment: z.string().trim().min(1).max(400).nullable(),
    suggestions: z.array(dailyPlanTaskSuggestion).max(3),
  })
  .strict();
/** Read-only request associated with the exact editable proposal. */
export const dailyPlanAssessmentInput = z
  .object({
    draft: DailyPlanSnapshot,
    proposalFingerprint: z.string().min(1).max(128),
  })
  .superRefine((input, context) => {
    if (input.draft.tasks.length > 100 || input.draft.sessions.length > 100) {
      context.addIssue({
        code: 'custom',
        message: 'Assessment supports at most 100 tasks and blocks.',
      });
    }
  });
/** Optional Athena note and explicit proposals, never a replacement schedule. */
export const dailyPlanAssessmentOut = z.object({
  proposalFingerprint: z.string(),
  assessment: dailyPlanAssessmentReply.shape.assessment,
  suggestions: z.array(dailyPlanTaskSuggestion.extend({ projectName: z.string() })).max(3),
});
/** Validated optional assessment response. */
export type DailyPlanAssessment = z.infer<typeof dailyPlanAssessmentOut>;
