import { describe, expect, it } from 'vitest';

import { canvasRelationCommand } from '../../../src/components/canvas/use-canvas-relation-drop-target';

const TASK_A_ID = '01J00000000000000000000001';
const TASK_B_ID = '01J00000000000000000000002';
const TASK_PARENT_ID = '01J00000000000000000000003';
const PROJECT_A_ID = '01J00000000000000000000011';
const PROJECT_B_ID = '01J00000000000000000000012';

describe('canvas relation commands', () => {
  it('maps a Task hierarchy drop to one receipt-backed parent command', () => {
    expect(
      canvasRelationCommand(
        {
          relationId: 'task.parent',
          effect: 'move',
          subjects: [
            { kind: 'task', id: TASK_A_ID, organizationId: 'org-1' },
            { kind: 'task', id: TASK_B_ID, organizationId: 'org-1' },
          ],
          target: { kind: 'task', id: TASK_PARENT_ID, organizationId: 'org-1' },
        },
        'command-task-parent',
      ),
    ).toEqual({
      command: {
        commandId: 'command-task-parent',
        objectKind: 'task',
        objectIds: [TASK_A_ID, TASK_B_ID],
        operation: { type: 'change_parent', parentId: TASK_PARENT_ID },
      },
      label: 'Move 2 Task branches',
    });
  });

  it('maps a Project-on-Project drop to one receipt-backed dependency command', () => {
    expect(
      canvasRelationCommand(
        {
          relationId: 'project.blocks',
          effect: 'link',
          subjects: [{ kind: 'project', id: PROJECT_A_ID, organizationId: 'org-1' }],
          target: { kind: 'project', id: PROJECT_B_ID, organizationId: 'org-1' },
        },
        'command-project-blocks',
      ),
    ).toEqual({
      command: {
        commandId: 'command-project-blocks',
        objectKind: 'project',
        objectIds: [PROJECT_A_ID, PROJECT_B_ID],
        operation: {
          type: 'add_dependency',
          blockingId: PROJECT_A_ID,
          blockedId: PROJECT_B_ID,
        },
      },
      label: 'Add dependency',
    });
  });

  it('rejects relations that the canvas history does not own', () => {
    expect(
      canvasRelationCommand(
        {
          relationId: 'task.project',
          effect: 'move',
          subjects: [{ kind: 'task', id: 'task-a', organizationId: 'org-1' }],
          target: { kind: 'project', id: 'project-a', organizationId: 'org-1' },
        },
        'command-unsupported',
      ),
    ).toBeNull();
  });
});
