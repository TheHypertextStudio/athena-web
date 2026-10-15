import type { Database } from '@docket/db';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotFoundError, CapabilityError } from '../../src/error';
import { readableLegacyWork } from '../../src/lib/recurrence/legacy-work-visibility';
const mocks = vi.hoisted(() => ({ live: vi.fn(), snapshot: vi.fn() }));
vi.mock('../../src/lib/work-creation/context', () => ({ loadCreationActor: mocks.live }));
vi.mock('../../src/lib/work-template-blueprints/snapshot', () => ({
  loadBlueprintSnapshot: mocks.snapshot,
}));
const identity = { organizationId: 'org', actorId: 'reader' };
const tx = {};
const database = {
  transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
} as unknown as Database;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.live.mockResolvedValue({ orgId: 'org', actorId: 'reader' });
  mocks.snapshot.mockResolvedValue({});
});
it('reloads actual membership and uses ordinary reference visibility in the same transaction', async () => {
  const reference = { kind: 'task' as const, id: 'task' };
  expect(await readableLegacyWork(database, identity, [reference])).toEqual(new Set(['task:task']));
  expect(mocks.live).toHaveBeenCalledWith(tx, 'org', 'reader');
  expect(mocks.snapshot).toHaveBeenCalledWith(tx, { orgId: 'org', actorId: 'reader' }, reference, {
    scope: 'reference',
    access: 'view',
  });
});
it('omits both missing and forbidden mapped work without returning its body', async () => {
  mocks.snapshot
    .mockRejectedValueOnce(new NotFoundError())
    .mockRejectedValueOnce(new CapabilityError())
    .mockResolvedValueOnce({ description: 'private prose must never be returned' });
  expect(
    await readableLegacyWork(database, identity, [
      { kind: 'task', id: 'missing' },
      { kind: 'task', id: 'hidden' },
      { kind: 'project', id: 'visible' },
    ]),
  ).toEqual(new Set(['project:visible']));
});
it('propagates infrastructure failures rather than silently hiding incomplete history', async () => {
  const failure = new Error('database unavailable');
  mocks.snapshot.mockRejectedValue(failure);
  await expect(readableLegacyWork(database, identity, [{ kind: 'task', id: 'task' }])).rejects.toBe(
    failure,
  );
});
it('denies revoked or inactive identity before checking any work', async () => {
  mocks.live.mockRejectedValue(new NotFoundError());
  await expect(
    readableLegacyWork(database, identity, [{ kind: 'task', id: 'task' }]),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
