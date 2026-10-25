import { expect, it, vi } from 'vitest';
import { registerInvocationRevision } from '../../src/invocation-revision-proof';
import { hashScheduleArchive } from '../../src/work-schedule-archive';
import { ScheduleSourceProofError } from '../../src/work-schedule-archive-source';
it('fails stored immutable evidence with missing original proof instead of treating it as an unconverted source', async () => {
  const archive = { revision: 1, source: {}, header: {}, revisionAudit: {} };
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ archive, hash: hashScheduleArchive(archive) }] })
    // Definition and revision locks, then the proved-source read finds no original receipt.
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(
    registerInvocationRevision({ execute }, 'source-revision'),
  ).rejects.not.toBeInstanceOf(ScheduleSourceProofError);
  expect(execute).toHaveBeenCalledTimes(4);
});
it('fails forged immutable archive integrity before attempting alias registration', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ archive: { revision: 1 }, hash: 'sha256:forged' }] });
  await expect(registerInvocationRevision({ execute }, 'source-revision')).rejects.toThrow(
    'archive integrity failed',
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
