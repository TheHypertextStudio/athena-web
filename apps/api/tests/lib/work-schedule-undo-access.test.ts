import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../src/mcp/change-set';
import type { StoredEntry } from '../../src/mcp/change-set-companions';
import { CapabilityError } from '../../src/error';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';
const mocks = vi.hoisted(() => ({ live: vi.fn(), work: vi.fn(), schedule: vi.fn() }));
vi.mock('../../src/lib/work-creation/context', () => ({ loadCreationActor: mocks.live }));
vi.mock('../../src/lib/work-template-selection', () => ({ requireWorkAccess: mocks.work }));
vi.mock('../../src/lib/recurrence/schedule-access', () => ({
  requireScheduleAccess: mocks.schedule,
}));
const caller = { orgId: 'org', actorId: 'editor', roleId: null, capabilities: [] };
const tx = {} as Tx;
function entry(
  entityKind: string,
  entityId: string,
  after: Record<string, unknown> = {},
): StoredEntry {
  return { entityKind, entityId, op: 'update', before: null, after };
}
function date(kind = 'native_schedule_date_ownership'): StoredEntry {
  return entry(kind, 'ownership', { workKind: 'task', workId: 'generated-task' });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.live.mockResolvedValue(caller);
  mocks.work.mockResolvedValue(undefined);
  mocks.schedule.mockResolvedValue({});
});
describe('current access for protected schedule undo receipts', () => {
  it('preserves ordinary undo without requiring a new membership check', async () => {
    await workScheduleUndoAccess(caller)(tx, [entry('task', 'ordinary')]);
    expect(mocks.live).not.toHaveBeenCalled();
    expect(mocks.work).not.toHaveBeenCalled();
  });
  it('requires both current routine management and ordinary Program management', async () => {
    mocks.work.mockRejectedValue(new CapabilityError());
    await expect(
      workScheduleUndoAccess(caller)(tx, [
        entry('program', 'program'),
        entry('program_default_schedule', 'routine'),
      ]),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(mocks.schedule).toHaveBeenCalledWith(
      tx,
      { organizationId: 'org', actorId: 'editor', seriesId: 'routine' },
      'manage',
    );
    expect(mocks.work).toHaveBeenCalledWith(tx, caller, 'program', 'program');
  });
  it.each(['native_schedule_date_ownership', 'retained_date_ownership'])(
    'authorizes %s through work rights without requiring private schedule visibility',
    async (kind) => {
      mocks.schedule.mockRejectedValue(new Error('Private schedule'));
      await workScheduleUndoAccess(caller)(tx, [date(kind), entry('project', 'derived-project')]);
      expect(mocks.work).toHaveBeenCalledWith(tx, caller, 'task', 'generated-task');
      expect(mocks.work).toHaveBeenCalledWith(tx, caller, 'project', 'derived-project');
      expect(mocks.schedule).not.toHaveBeenCalled();
    },
  );
  it('denies a revoked contributor and refuses malformed stored companion identities', async () => {
    mocks.live.mockRejectedValueOnce(new CapabilityError());
    await expect(workScheduleUndoAccess(caller)(tx, [date()])).rejects.toBeInstanceOf(
      CapabilityError,
    );
    await expect(
      workScheduleUndoAccess(caller)(tx, [entry('native_schedule_date_ownership', 'bad')]),
    ).rejects.toThrow();
  });
  it('checks every affected row and deduplicates a companion alongside its ordinary work entry', async () => {
    mocks.work.mockImplementation(async (_tx, _caller, _kind, id) => {
      if (id === 'hidden-derived-task') throw new CapabilityError();
    });
    await expect(
      workScheduleUndoAccess(caller)(tx, [
        date(),
        entry('task', 'generated-task'),
        entry('task', 'hidden-derived-task'),
      ]),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(mocks.work).toHaveBeenCalledTimes(2);
  });
  it('resolves a signed-in user to their live tenant member inside the undo transaction', async () => {
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'actual-member' }]),
    };
    const database = { select: vi.fn(() => query) } as unknown as Tx;
    await workScheduleUndoAccess({ orgId: 'org', userId: 'signed-in-user' })(database, [date()]);
    expect(mocks.live).toHaveBeenCalledWith(database, 'org', 'actual-member');
  });
  it('requires a Milestone’s actual Project and ordinary label-set subjects', async () => {
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ projectId: 'actual-project' }]),
    };
    const database = { select: vi.fn(() => query) } as unknown as Tx;
    await workScheduleUndoAccess(caller)(database, [
      date(),
      entry('milestone', 'checkpoint'),
      entry('project_labels', 'labeled-project'),
    ]);
    expect(mocks.work).toHaveBeenCalledWith(database, caller, 'project', 'actual-project');
    expect(mocks.work).toHaveBeenCalledWith(database, caller, 'project', 'labeled-project');
  });
});
