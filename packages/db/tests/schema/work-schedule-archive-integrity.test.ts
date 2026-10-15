import { expect, it, vi } from 'vitest';
import {
  hashScheduleArchive,
  verifyWorkScheduleArchiveIntegrity,
} from '../../src/work-schedule-archive';
const archive = { revision: 1, header: { name: 'Original name' }, source: {}, revisionAudit: {} };
it('validates original frozen receipt hashes without treating them as current mutable state', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ archive, hash: hashScheduleArchive(archive) }] });
  await expect(verifyWorkScheduleArchiveIntegrity({ execute })).resolves.toBeUndefined();
});
it.each([
  { archive, hash: 'sha256:corrupt' },
  { archive: null, hash: hashScheduleArchive(archive) },
  { archive, hash: null },
])('refuses corrupt or one-sided archived receipt integrity', async (receipt) => {
  const execute = vi.fn().mockResolvedValue({ rows: [receipt] });
  await expect(verifyWorkScheduleArchiveIntegrity({ execute })).rejects.toThrow(
    'archive integrity failed',
  );
});
