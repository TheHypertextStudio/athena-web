/** Public transports share these permission and date-identity checks; the runtime stays canonical. */
import { db } from '@docket/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../src/error';
import { runWorkSchedule, retryWorkSchedule } from '../../src/lib/recurrence/schedule-run-commands';

const services = vi.hoisted(() => ({
  access: vi.fn(),
  revision: vi.fn(),
  execute: vi.fn(),
  retry: vi.fn(),
  load: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/schedule-access', () => ({
  requireScheduleAccess: services.access,
}));
vi.mock('../../src/lib/recurrence/series', () => ({ seriesRevisionAt: services.revision }));
vi.mock('../../src/lib/recurrence/schedule-runtime', () => ({
  executeScheduleOccurrence: services.execute,
  retryScheduleOccurrence: services.retry,
}));
vi.mock('../../src/lib/recurrence/schedule-history', () => ({
  loadWorkScheduleRun: services.load,
}));
const access = { organizationId: 'org', actorId: 'actor', seriesId: 'series' };
beforeEach(() => {
  vi.resetAllMocks();
  services.revision.mockResolvedValue({ id: 'reviewed-revision', triggerKind: 'manual' });
  services.execute.mockResolvedValue({ occurrenceId: 'run' });
  services.load.mockResolvedValue({ id: 'run' });
});
describe('public schedule run commands', () => {
  it.each(['calendar', 'after_completion'])(
    'prevents alternate keys from duplicating %s dates',
    async (triggerKind) => {
      services.revision.mockResolvedValue({ id: 'revision', triggerKind });
      await expect(
        runWorkSchedule(db, access, { scheduledFor: '2026-10-15', occurrenceKey: 'another' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(services.execute).not.toHaveBeenCalled();
    },
  );
  it('uses the governing saved revision and forwards explicit manual identity', async () => {
    await runWorkSchedule(db, access, { scheduledFor: '2026-10-15', occurrenceKey: 'stable' });
    expect(services.access).toHaveBeenCalledWith(db, access, 'manage');
    expect(services.revision).toHaveBeenCalledWith(db, 'org', 'series', '2026-10-15');
    expect(services.execute).toHaveBeenCalledWith(db, {
      organizationId: 'org',
      seriesId: 'series',
      seriesRevisionId: 'reviewed-revision',
      scheduledFor: '2026-10-15',
      externalOccurrenceKey: 'stable',
    });
  });
  it('rejects another schedule run before retry execution', async () => {
    services.load.mockRejectedValue(new NotFoundError());
    await expect(retryWorkSchedule(db, access, 'foreign-run')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(services.retry).not.toHaveBeenCalled();
  });
  it('checks live private management before reading or executing', async () => {
    services.access.mockRejectedValue(new NotFoundError());
    await expect(
      runWorkSchedule(db, access, { scheduledFor: '2026-10-15' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(services.revision).not.toHaveBeenCalled();
    expect(services.execute).not.toHaveBeenCalled();
  });
  it('carries the actual foreground manager for an explicit missed-run resolution', async () => {
    services.load.mockResolvedValue({ id: 'missed', status: 'needs_resolution', canRetry: true });
    await retryWorkSchedule(db, access, 'missed');
    expect(services.retry).toHaveBeenCalledWith(db, {
      organizationId: 'org',
      occurrenceId: 'missed',
      actorId: 'actor',
    });
  });
});
