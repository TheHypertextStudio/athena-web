import type { Database } from '@docket/db';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/error';
import {
  listCompatibleRecurrenceSeries,
  requireCanonicalRecurrenceAccess,
} from '../../src/lib/recurrence/schedule-compatibility-access';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), load: vi.fn() }));
vi.mock('../../src/lib/recurrence/schedule-access', () => ({
  requireScheduleAccess: mocks.authorize,
}));
vi.mock('../../src/lib/recurrence/series', () => ({ loadRecurrenceSeries: mocks.load }));
const input = { organizationId: 'org', actorId: 'reader', seriesId: 'legacy' };
function database(rows: readonly unknown[]): Database {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { select: vi.fn(() => query) } as unknown as Database;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({});
  mocks.load.mockImplementation(async (_db, _org, seriesId) => ({ id: seriesId }));
});
it('checks current scope for legacy series with a non-null definition alias', async () => {
  mocks.authorize.mockRejectedValue(new NotFoundError());
  await expect(
    requireCanonicalRecurrenceAccess(database([{ definitionId: 'definition' }]), input, 'view'),
  ).rejects.toBeInstanceOf(NotFoundError);
});
it('retains actual manage authorization on the exact legacy series', async () => {
  const db = database([{ definitionId: 'definition' }]);
  await requireCanonicalRecurrenceAccess(db, input, 'manage');
  expect(mocks.authorize).toHaveBeenCalledWith(db, input, 'manage');
});
it('filters private legacy list entries before loading their names or details', async () => {
  mocks.authorize.mockImplementation(async (_db, request) => {
    if (request.seriesId === 'hidden') throw new NotFoundError();
    return {};
  });
  const db = database([
    { id: 'hidden', definitionId: 'legacy-private' },
    { id: 'visible', definitionId: null },
  ]);
  expect(
    await listCompatibleRecurrenceSeries(db, {
      organizationId: 'org',
      actorId: 'reader',
      limit: 50,
    }),
  ).toEqual([{ id: 'visible' }]);
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
