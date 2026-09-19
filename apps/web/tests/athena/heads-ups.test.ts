import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dismissHeadsUp, dismissedHeadsUpIds, headsUpsFor } from '../../src/lib/athena/heads-ups';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';

const NOW = new Date('2026-09-18T15:00:00.000Z');

/** A needs-you job last touched 90 minutes before {@link NOW} — past the 60-minute threshold. */
function waitingJob(
  overrides: Partial<PersonalAthenaSessionSummary> = {},
): PersonalAthenaSessionSummary {
  return {
    id: 'job_waiting',
    objective: 'Approve the vendor invoice',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    createdAt: '2026-09-18T13:00:00.000Z',
    updatedAt: '2026-09-18T13:30:00.000Z',
    ...overrides,
  };
}

/** A failed job, in the finished lane the way `athenaQueueState` maps it. */
function failedJob(
  overrides: Partial<PersonalAthenaSessionSummary> = {},
): PersonalAthenaSessionSummary {
  return {
    id: 'job_failed',
    objective: 'Send the launch email',
    status: 'failed',
    queueState: 'finished',
    createdAt: '2026-09-18T14:00:00.000Z',
    updatedAt: '2026-09-18T14:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('headsUpsFor waiting trigger', () => {
  it('surfaces a needs-you job once it has waited past the threshold', () => {
    const job = waitingJob();
    const [headsUp] = headsUpsFor([job], NOW);

    expect(headsUp).toBeDefined();
    expect(headsUp?.jobId).toBe(job.id);
    expect(headsUp?.action).toBe('review');
    expect(headsUp?.text).toContain(job.objective);
  });

  it('says nothing for a needs-you job that has not waited long enough', () => {
    const job = waitingJob({ updatedAt: '2026-09-18T14:30:00.000Z' });
    expect(headsUpsFor([job], NOW)).toHaveLength(0);
  });

  it('says nothing for an overdue job outside the needs-you lane', () => {
    const job = waitingJob({ status: 'running', queueState: 'working' });
    expect(headsUpsFor([job], NOW)).toHaveLength(0);
  });
});

describe('headsUpsFor stopped trigger', () => {
  it('surfaces a failed job', () => {
    const job = failedJob();
    const [headsUp] = headsUpsFor([job], NOW);

    expect(headsUp).toBeDefined();
    expect(headsUp?.jobId).toBe(job.id);
    expect(headsUp?.action).toBe('review');
    expect(headsUp?.text).toContain(job.objective);
  });
});

describe('headsUpsFor one-at-a-time rule', () => {
  it('returns only the oldest waiting job when several qualify', () => {
    const older = waitingJob({ id: 'job_older', updatedAt: '2026-09-18T12:00:00.000Z' });
    const newer = waitingJob({ id: 'job_newer', updatedAt: '2026-09-18T13:30:00.000Z' });
    const [headsUp] = headsUpsFor([newer, older], NOW);

    expect(headsUp?.jobId).toBe(older.id);
    expect(headsUpsFor([newer, older], NOW)).toHaveLength(1);
  });

  it('prefers a waiting job over a failed one when both qualify', () => {
    const waiting = waitingJob();
    const failed = failedJob();
    const result = headsUpsFor([failed, waiting], NOW);

    expect(result).toHaveLength(1);
    expect(result[0]?.jobId).toBe(waiting.id);
  });

  it('falls back to a failed job only once no job is waiting', () => {
    const notOverdue = waitingJob({ updatedAt: '2026-09-18T14:45:00.000Z' });
    const failed = failedJob();
    const result = headsUpsFor([notOverdue, failed], NOW);

    expect(result).toHaveLength(1);
    expect(result[0]?.jobId).toBe(failed.id);
  });
});

describe('heads-up dismissal', () => {
  it('excludes a dismissed heads-up from later reads', () => {
    const job = waitingJob();
    const [headsUp] = headsUpsFor([job], NOW);
    if (!headsUp) throw new Error('expected a heads-up before dismissal');

    dismissHeadsUp(headsUp.id);

    expect(dismissedHeadsUpIds().has(headsUp.id)).toBe(true);
    expect(headsUpsFor([job], NOW)).toHaveLength(0);
  });

  it('resurfaces once the same job waits again after its updatedAt moves', () => {
    const job = waitingJob();
    const [headsUp] = headsUpsFor([job], NOW);
    if (!headsUp) throw new Error('expected a heads-up before dismissal');
    dismissHeadsUp(headsUp.id);

    const repliedTo = waitingJob({ updatedAt: '2026-09-18T14:59:00.000Z' });
    expect(headsUpsFor([repliedTo], NOW)).toHaveLength(0);

    const waitedAgain = waitingJob({ updatedAt: '2026-09-18T14:59:00.000Z' });
    const later = new Date('2026-09-18T16:30:00.000Z');
    const [resurfaced] = headsUpsFor([waitedAgain], later);

    expect(resurfaced).toBeDefined();
    expect(resurfaced?.id).not.toBe(headsUp.id);
  });
});
