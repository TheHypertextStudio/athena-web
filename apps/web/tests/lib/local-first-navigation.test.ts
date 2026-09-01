import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';
import { TaskNavigationSnapshot } from '../../src/lib/contracts/entity-navigation';
import { type TaskOut } from '@docket/work/task-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { seedNavigationSnapshot } = vi.hoisted(() => ({
  seedNavigationSnapshot: vi.fn(),
}));

vi.mock('@/lib/navigation-snapshot-runtime', () => ({ seedNavigationSnapshot }));

const { openEntity, openTaskRecord } = await import('@/lib/local-first-navigation');

const snapshot = TaskNavigationSnapshot.parse({
  target: 'task',
  organizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  id: TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  title: 'Fix route transitions',
  status: 'started',
  priority: 'high',
  updatedAt: '2026-08-23T11:00:00.000Z',
});

beforeEach(() => {
  seedNavigationSnapshot.mockReset();
  window.history.replaceState(null, '', '/today');
  window.scrollTo = vi.fn();
});

describe('openEntity', () => {
  it('seeds identity before it commits the validated browser route', () => {
    const events: string[] = [];
    seedNavigationSnapshot.mockImplementation(() => {
      events.push('seed');
    });
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation((...args) => {
      events.push('navigate');
      History.prototype.pushState.apply(window.history, args);
    });

    openEntity(snapshot);

    expect(events).toEqual(['seed', 'navigate']);
    expect(window.location.pathname).toBe(`/orgs/${snapshot.organizationId}/tasks/${snapshot.id}`);
    pushState.mockRestore();
  });

  it('rejects malformed snapshots before seeding or changing history', () => {
    expect(() => {
      openEntity({ ...snapshot, id: 'not-an-id' } as never);
    }).toThrow();

    expect(seedNavigationSnapshot).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/today');
  });

  it('derives the Task snapshot from a typed detail row when its recency field is present', () => {
    const task: TaskOut = {
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      title: snapshot.title,
      teamId: TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAT'),
      state: snapshot.status,
      priority: snapshot.priority,
      autoCompletedBySubtasks: false,
      provenance: { source: 'native' },
      labels: [],
      createdAt: '2026-08-23T10:00:00.000Z',
      updatedAt: snapshot.updatedAt,
    };

    openTaskRecord(task);

    expect(seedNavigationSnapshot).toHaveBeenCalledWith(snapshot);
    expect(window.location.pathname).toBe(`/orgs/${snapshot.organizationId}/tasks/${snapshot.id}`);
  });
});
