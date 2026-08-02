/**
 * `time/service` — public Time Ledger service boundary.
 *
 * @remarks
 * Existing callers keep one stable import path, while implementation is split by responsibility:
 * `commands` writes normalized facts, `read-models` builds privacy-safe projections, `access`
 * owns policy, and `reporting` snapshots recipient-safe submissions. New code should import the
 * narrow module when it needs one responsibility; routes may use this façade for composition.
 */
export {
  addHistoricalInterval,
  addTimeContext,
  createTimeCategory,
  createTimeRecord,
  pauseTimeRecord,
  removeTimeContext,
  replaceTimeAllocations,
  startTimeRecord,
  stopTimeRecord,
  updateTimeRecord,
} from './commands';
export {
  getActiveTime,
  getTimeBreakdown,
  getTimeSummary,
  getTimeTimeline,
  listTimeCategories,
} from './read-models';
export {
  createTimeSubmission,
  getTimeSubmission,
  listOrganizationTimeSubmissions,
} from './reporting';
export {
  createTimeShareToken,
  listTimeShareTokens,
  readSharedTimerStatus,
  revokeTimeShareToken,
  SHARE_TOKEN_HEADER,
} from './share';
export { resolveTaskAnchor } from './task-anchor';
export { TIMER_JOIN_WINDOW_MS, shouldJoinSegment } from './timer-join';
export { resolveTimeHubId } from './access';
