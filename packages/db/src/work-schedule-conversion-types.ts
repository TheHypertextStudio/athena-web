export {
  ScheduleConversionReceipt,
  ScheduleConversionPublication,
} from '@docket/work/work-schedule-import';
/** Retryable private uncertainty; the original body remains in its unchanged archive/invocation. */
export type ScheduleConversionReviewCode =
  | 'original_source_unproved'
  | 'alias_unproved'
  | 'timezone_unproved'
  | 'closure_unproved'
  | 'pending_source'
  | 'missing_selection'
  | 'oversized_source'
  | 'invalid_structure'
  | 'unsupported_timing';
/** A private review on the series revision grants no execution or continuation rights. */
export interface ScheduleConversionReview {
  readonly kind: 'schedule_conversion_review';
  readonly revision: 1;
  readonly execution: 'nonexecuting';
  readonly code: ScheduleConversionReviewCode;
}
