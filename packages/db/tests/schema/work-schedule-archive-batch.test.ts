import { expect, it, vi } from 'vitest';
import { archiveWorkScheduleSourceBatch } from '../../src/work-schedule-archive-batch';
import { ScheduleSourceProofError } from '../../src/work-schedule-archive-source';
const options = {
  kind: 'revisions' as const,
  size: 2,
  after: null,
  verification: 'checkpoint' as const,
};
it('advances beyond deferred source without claiming it was archived or dropping subsequent rows', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 'blocked' }, { id: 'good' }] });
  const archive = vi.fn(async (id: string) => {
    if (id === 'blocked') throw new ScheduleSourceProofError('Unproved root order');
  });
  expect(await archiveWorkScheduleSourceBatch({ execute }, options, archive)).toEqual({
    archived: 1,
    deferred: 1,
    after: 'good',
  });
  expect(archive).toHaveBeenCalledTimes(2);
});
it('preserves strict first-archive proof refusal for explicit retirement', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 'blocked' }] });
  const archive = vi.fn().mockRejectedValue(new ScheduleSourceProofError('Unproved root order'));
  await expect(
    archiveWorkScheduleSourceBatch(
      { execute },
      { ...options, verification: 'retirement' },
      archive,
    ),
  ).rejects.toThrow('Unproved root order');
});
it('never downgrades a storage failure into deferred source proof', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 'source' }] });
  const failure = new Error('Storage failure');
  await expect(
    archiveWorkScheduleSourceBatch({ execute }, options, vi.fn().mockRejectedValue(failure)),
  ).rejects.toBe(failure);
});
it('finishes when no pending source remains', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const archive = vi.fn();
  expect(await archiveWorkScheduleSourceBatch({ execute }, options, archive)).toEqual({
    archived: 0,
    deferred: 0,
    after: null,
  });
  expect(archive).not.toHaveBeenCalled();
});
