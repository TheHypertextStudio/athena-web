/**
 * `tasks/task-time-estimate-action` — "Time estimate…", Sunsama's `W`, as a task action.
 *
 * @remarks
 * Opens the moved time-estimate popover on every task the invocation names, so the right-click
 * menu, the row's ⋯ menu, and the command palette over a selection all set estimates the same way
 * the Time column and the `W` key do.
 */
import { Hourglass } from '@docket/ui/icons';

import type { PickerOverlayApi } from '@/components/pickers/picker-overlay';
import type { ActionContext, ActionDefinitionInput } from '@/lib/actions';

/** The "Time estimate…" declaration: a synchronous action, so it carries no receipt ownership. */
export interface TaskTimeEstimateAction extends ActionDefinitionInput {
  readonly run: (context: ActionContext) => void;
  readonly responsiveness?: never;
}

/**
 * Build the "Time estimate…" action.
 *
 * @param pickerOverlay - The app's picker overlay.
 * @returns the action declaration, for the task domain's `defineActionDomain`.
 */
export function taskTimeEstimateAction(pickerOverlay: PickerOverlayApi): TaskTimeEstimateAction {
  return {
    id: 'task.timeEstimate',
    label: 'Time estimate…',
    icon: Hourglass,
    objectKinds: ['task'],
    multi: true,
    section: 'organize',
    shortcutHint: 'W',
    keywords: ['estimate', 'planned time', 'duration', 'how long'],
    run: (context: ActionContext) => {
      // A row may carry a task without its workspace; the invocation always knows one.
      const objects = context.objects.flatMap((object) =>
        object.kind === 'task'
          ? [{ ...object, organizationId: object.organizationId ?? context.organizationId }]
          : [],
      );
      if (objects.length === 0) return;
      pickerOverlay.open({ kind: 'estimate-time', objects });
    },
  } satisfies ActionDefinitionInput;
}
