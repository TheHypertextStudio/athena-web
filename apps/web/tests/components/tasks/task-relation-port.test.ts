import { describe, expect, it, vi } from 'vitest';

import {
  createTaskAssociationCommandPort,
  createTaskRelationCommandPort,
} from '../../../src/components/tasks/task-relation-port';

describe('Task relation command port', () => {
  it.each([
    ['task.project', 'project', 'projectId'],
    ['task.program', 'program', 'programId'],
    ['task.cycle', 'cycle', 'cycleId'],
    ['task.milestone', 'milestone', 'milestoneId'],
    ['task.assignee', 'actor', 'assigneeId'],
  ] as const)('maps %s to the typed Task patch field', async (relationId, targetKind, field) => {
    const patchTask = vi.fn(async () => undefined);
    const port = createTaskRelationCommandPort({ patchTask });

    await expect(
      port.execute({
        relationId,
        effect: 'move',
        subjects: [
          { kind: 'task', id: 'task-1', organizationId: 'org-1' },
          { kind: 'task', id: 'task-2', organizationId: 'org-1' },
        ],
        target: { kind: targetKind, id: 'target-1', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'applied' });

    expect(patchTask).toHaveBeenNthCalledWith(1, 'org-1', 'task-1', {
      [field]: 'target-1',
    });
    expect(patchTask).toHaveBeenNthCalledWith(2, 'org-1', 'task-2', {
      [field]: 'target-1',
    });
  });

  it('does not write a single-value relation that already has the target', async () => {
    const patchTask = vi.fn(async () => undefined);
    const port = createTaskRelationCommandPort({ patchTask });

    await expect(
      port.execute({
        relationId: 'task.project',
        effect: 'move',
        subjects: [
          {
            kind: 'task',
            id: 'task-1',
            organizationId: 'org-1',
            meta: { projectId: 'project-1' },
          },
        ],
        target: { kind: 'project', id: 'project-1', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'unchanged' });
    expect(patchTask).not.toHaveBeenCalled();
  });
});

describe('Task association command port', () => {
  const dependencies = () => ({
    reparent: vi.fn(async () => undefined),
    addDependency: vi.fn(async () => 'applied' as const),
    addLabel: vi.fn(async () => 'unchanged' as const),
    linkCalendarItem: vi.fn(async () => 'applied' as const),
    scheduleCalendarSlot: vi.fn(async () => 'applied' as const),
  });

  it('maps hierarchy and dependency intents to Task-owned services', async () => {
    const services = dependencies();
    const port = createTaskAssociationCommandPort(services);
    const subjects = [{ kind: 'task' as const, id: 'task-1', organizationId: 'org-1' }];

    await port.execute({
      relationId: 'task.parent',
      effect: 'move',
      subjects,
      target: { kind: 'task', id: 'task-2', organizationId: 'org-1' },
    });
    await port.execute({
      relationId: 'task.blocks',
      effect: 'link',
      subjects,
      target: { kind: 'task', id: 'task-3', organizationId: 'org-1' },
    });

    expect(services.reparent).toHaveBeenCalledWith('org-1', [
      { taskId: 'task-1', parentTaskId: 'task-2' },
    ]);
    expect(services.addDependency).toHaveBeenCalledWith('org-1', 'task-1', 'task-3');
  });

  it('keeps duplicate link results unchanged and forwards exact calendar times', async () => {
    const services = dependencies();
    const port = createTaskAssociationCommandPort(services);
    const subject = {
      kind: 'task' as const,
      id: 'task-1',
      organizationId: 'org-1',
      meta: { title: 'Write the release note' },
    };

    await expect(
      port.execute({
        relationId: 'task.label',
        effect: 'link',
        subjects: [subject],
        target: { kind: 'label', id: 'label-1', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'unchanged' });
    await port.execute({
      relationId: 'task.calendar-slot',
      effect: 'copy',
      subjects: [subject],
      target: {
        kind: 'calendar_slot',
        id: '2026-08-24T16:00:00.000Z',
        organizationId: null,
        meta: {
          startsAt: '2026-08-24T16:00:00.000Z',
          endsAt: '2026-08-24T16:30:00.000Z',
        },
      },
    });

    expect(services.scheduleCalendarSlot).toHaveBeenCalledWith(
      'org-1',
      'task-1',
      'Write the release note',
      '2026-08-24T16:00:00.000Z',
      '2026-08-24T16:30:00.000Z',
    );
  });
});
