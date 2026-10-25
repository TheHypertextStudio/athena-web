import type { Database } from '@docket/db';
import { beforeEach, expect, it, vi } from 'vitest';
import { occurrenceOutputs } from '../../src/lib/recurrence/series-occurrence-output';

const mocks = vi.hoisted(() => ({ visible: vi.fn(), facts: vi.fn() }));
vi.mock('../../src/lib/recurrence/legacy-work-visibility', () => ({
  readableLegacyWork: mocks.visible,
}));
vi.mock('../../src/lib/recurrence/series-history-references', () => ({
  occurrenceReferenceFacts: mocks.facts,
}));

const organizationId = '01BX5ZZKBKACTAV9WEVGEMMVRC';
const seriesId = '01BX5ZZKBKACTAV9WEVGEMMVRE';
const occurrenceId = '01BX5ZZKBKACTAV9WEVGEMMVRG';
const instanceId = '01BX5ZZKBKACTAV9WEVGEMMVRH';
const taskId = '01BX5ZZKBKACTAV9WEVGEMMVRK';
const projectId = '01BX5ZZKBKACTAV9WEVGEMMVRJ';
const references = [
  { instanceId, id: taskId, kind: 'task' },
  { instanceId, id: projectId, kind: 'project' },
] as const;

function databaseFixture(): Database {
  const occurrence = {
    id: occurrenceId,
    seriesId,
    scheduledFor: '2026-08-10',
    originalScheduledFor: null,
    status: 'completed',
    resolvedAt: null,
    legacyInstanceId: null,
    blueprintAppliedAt: null,
    blueprintRootRefs: null,
    native: false,
    historical: false,
  };
  const select = vi.fn().mockReturnValueOnce({
    from: () => ({
      leftJoin: () => ({ where: () => ({ orderBy: async () => [occurrence] }) }),
    }),
  });
  return { select } as unknown as Database;
}

beforeEach(() => {
  mocks.visible.mockReset();
  mocks.facts.mockReset();
  mocks.facts.mockResolvedValue({ instances: new Map([[occurrenceId, instanceId]]), references });
});

it('returns only readable generated references and checks project visibility alongside tasks', async () => {
  const database = databaseFixture();
  mocks.visible.mockResolvedValue(new Set([`task:${taskId}`]));
  const result = await occurrenceOutputs(database, organizationId, seriesId, 'actor');
  expect(result[0]).toMatchObject({ taskId, projectId: null });
  expect(mocks.visible).toHaveBeenCalledWith(
    database,
    { organizationId, actorId: 'actor' },
    references,
  );
});

it('retains a readable project when its task is private or gone', async () => {
  mocks.visible.mockResolvedValue(new Set([`project:${projectId}`]));
  expect(
    (await occurrenceOutputs(databaseFixture(), organizationId, seriesId, 'actor'))[0],
  ).toMatchObject({ taskId: null, projectId });
});

it('propagates visibility failures rather than presenting incomplete history as complete', async () => {
  const failure = new Error('storage unavailable');
  mocks.visible.mockRejectedValue(failure);
  await expect(
    occurrenceOutputs(databaseFixture(), organizationId, seriesId, 'actor'),
  ).rejects.toBe(failure);
});
