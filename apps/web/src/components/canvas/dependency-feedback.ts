/**
 * `components/canvas/dependency-feedback` — the command notice copy for a dependency edit.
 *
 * @remarks
 * The Task graph and the Project dependencies canvas edit dependencies through the same command
 * history and word the outcome the same way, so the copy lives here once.
 */
import type { CanvasCommandFeedback } from './use-canvas-command-history';

/** Whether a dependency edit creates the edge or deletes it. */
export type DependencyEditType = 'add_dependency' | 'remove_dependency';

/**
 * The history label and notice copy for one dependency edit.
 *
 * @param type - Whether the edge is added or removed.
 * @param blockingName - The name of the object that must finish first.
 * @param blockedName - The name of the object that waits.
 * @returns the feedback the command history shows for the edit and for a no-op replay of it.
 */
export function dependencyFeedback(
  type: DependencyEditType,
  blockingName: string,
  blockedName: string,
): CanvasCommandFeedback {
  if (type === 'add_dependency') {
    return {
      historyLabel: 'Add dependency',
      title: 'Dependency added',
      detail: `${blockedName} depends on ${blockingName}`,
      unchangedTitle: 'Dependency unchanged',
      unchangedDetail: `${blockedName} already depends on ${blockingName}`,
    };
  }
  return {
    historyLabel: 'Remove dependency',
    title: 'Dependency removed',
    detail: `${blockedName} no longer depends on ${blockingName}`,
    unchangedTitle: 'Dependency unchanged',
    unchangedDetail: `${blockedName} did not depend on ${blockingName}`,
  };
}
