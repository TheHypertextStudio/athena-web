/** `@docket/web` — recoverable canvas trash confirmation rules. */
import { describe, expect, it } from 'vitest';

import { canvasTrashConfirmation } from '@/components/canvas/canvas-command-context';
import type { ObjectRef } from '@/lib/actions';

const task: ObjectRef = {
  kind: 'task',
  id: 'task-1',
  title: 'Write brief',
  organizationId: 'org-1',
};

function project(taskCount: number): ObjectRef {
  return {
    kind: 'project',
    id: `project-${String(taskCount)}`,
    title: 'Transit plan',
    organizationId: 'org-1',
    meta: { taskCount },
  };
}

describe('canvasTrashConfirmation', () => {
  it('moves one Task and one empty Project without an extra confirmation', () => {
    expect(canvasTrashConfirmation([task])).toBeNull();
    expect(canvasTrashConfirmation([project(0)])).toBeNull();
  });

  it('explains retained Task links before trashing a nonempty Project', () => {
    const confirmation = canvasTrashConfirmation([project(3)]);
    expect(confirmation?.title).toBe('Move Transit plan to trash?');
    expect(confirmation?.description).toContain('3 Tasks remain linked');
    expect(confirmation?.description).toContain('Restoring the Project');
  });

  it('requires confirmation for any multi-object selection and names its counts', () => {
    const confirmation = canvasTrashConfirmation([task, { ...task, id: 'task-2' }]);
    expect(confirmation?.title).toBe('Move 2 tasks to trash?');
    expect(confirmation?.description).toContain('restoring');
  });
});
