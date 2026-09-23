/**
 * "Time estimate…" opens the moved time-estimate popover on the invocation's tasks, filling in the
 * invocation's workspace for a row that carried none.
 */
import { describe, expect, it, vi } from 'vitest';

import { taskTimeEstimateAction } from '@/components/tasks/task-time-estimate-action';
import type { ActionContext } from '@/lib/actions';

const ORG = '01HZX5K3QJ9F8B7C6D5E4F3G2H';

/** An invocation over the given objects. */
function context(objects: ActionContext['objects']): ActionContext {
  return { objects, organizationId: ORG } as ActionContext;
}

describe('taskTimeEstimateAction', () => {
  it('opens the popover on every task, in the invocation workspace', () => {
    const open = vi.fn();
    const action = taskTimeEstimateAction({ open });

    action.run(
      context([
        { kind: 'task', id: 'a', organizationId: ORG, title: 'A' },
        { kind: 'task', id: 'b', organizationId: null, title: 'B' },
      ]),
    );

    expect(open).toHaveBeenCalledWith({
      kind: 'estimate-time',
      objects: [
        { kind: 'task', id: 'a', organizationId: ORG, title: 'A' },
        { kind: 'task', id: 'b', organizationId: ORG, title: 'B' },
      ],
    });
  });

  it('does nothing without a task', () => {
    const open = vi.fn();

    taskTimeEstimateAction({ open }).run(context([]));

    expect(open).not.toHaveBeenCalled();
  });
});
