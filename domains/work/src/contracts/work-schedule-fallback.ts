import { z } from 'zod';
import { AcceptedScheduleClaim, AcceptedScheduleRoots } from './work-schedule-claim';

/** Exact authoring-time closure; used only when this revision has no later accepted occurrence. */
export const WorkScheduleRevisionFallback = z.strictObject({
  kind: z.literal('schedule_fallback'),
  revision: z.literal(1),
  seriesRevisionId: AcceptedScheduleClaim.shape.seriesRevisionId,
  sourceInvocationId: AcceptedScheduleClaim.shape.sourceInvocationId,
  draftFingerprint: AcceptedScheduleClaim.shape.draftFingerprint,
  roots: AcceptedScheduleRoots,
});
/** Private persisted fallback data; parsing alone never confers archived execution authority. */
export type WorkScheduleRevisionFallback = z.infer<typeof WorkScheduleRevisionFallback>;
