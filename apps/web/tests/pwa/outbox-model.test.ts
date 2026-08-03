import { describe, expect, it } from 'vitest';

import {
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
  afterReplay,
  classifyReplay,
  describeWrite,
  expireAged,
  isQueueableWrite,
  isReplayable,
  pendingCount,
  stalledCount,
} from '@/components/pwa/outbox-model';

/**
 * The offline write queue's rules.
 *
 * @remarks
 * Every case here is one where getting it wrong loses or duplicates somebody's work, which is why
 * the rules live in a module with no IndexedDB and no `fetch` in it. The interesting ones are the
 * refusals: what may never be queued (auth), and what a server's answer entitles the queue to do
 * (retry versus give up).
 */

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'e1',
    userId: 'u1',
    method: 'PATCH',
    path: '/v1/orgs/o1/tasks/t1',
    body: '{"title":"x"}',
    contentType: 'application/json',
    label: 'Task change',
    createdAt: NOW,
    attempts: 0,
    status: 'queued',
    ...overrides,
  };
}

describe('isQueueableWrite', () => {
  it('takes responsibility for API writes only', () => {
    expect(isQueueableWrite('POST', '/v1/orgs/o1/tasks')).toBe(true);
    expect(isQueueableWrite('patch', '/v1/orgs/o1/tasks/t1')).toBe(true);
    expect(isQueueableWrite('DELETE', '/v1/orgs/o1/tasks/t1')).toBe(true);
  });

  it('never queues a read — a failed read has nothing to replay', () => {
    expect(isQueueableWrite('GET', '/v1/orgs/o1/tasks')).toBe(false);
    expect(isQueueableWrite('HEAD', '/v1/orgs/o1/tasks')).toBe(false);
    expect(isQueueableWrite('OPTIONS', '/v1/orgs/o1/tasks')).toBe(false);
  });

  it('never queues auth traffic', () => {
    // Replaying a sign-in or a passkey ceremony minutes later is useless at best.
    expect(isQueueableWrite('POST', '/api/auth/sign-in/passkey')).toBe(false);
    expect(isQueueableWrite('POST', '/api/auth')).toBe(false);
  });

  it('ignores anything outside the typed API', () => {
    expect(isQueueableWrite('POST', '/some/other/thing')).toBe(false);
    expect(isQueueableWrite('POST', '/v1x/orgs')).toBe(false);
  });
});

describe('describeWrite', () => {
  it('names the change in the product’s own words', () => {
    expect(describeWrite('POST', '/v1/orgs/o1/tasks')).toBe('New task');
    expect(describeWrite('PATCH', '/v1/orgs/o1/tasks/t1')).toBe('Task change');
    expect(describeWrite('DELETE', '/v1/orgs/o1/tasks/t1')).toBe('Archived task');
    expect(describeWrite('POST', '/v1/orgs/o1/tasks/t1/comments')).toBe('Comment');
    expect(describeWrite('POST', '/v1/orgs/o1/projects')).toBe('New project');
    expect(describeWrite('PATCH', '/v1/orgs/o1/projects/p1')).toBe('Project change');
  });

  it('still says something human for a write it has no rule for', () => {
    // A pending-change list must never show a raw URL, and must never be empty.
    expect(describeWrite('POST', '/v1/orgs/o1/labels')).toBe('New item');
    expect(describeWrite('PUT', '/v1/orgs/o1/anything')).toBe('Change');
    expect(describeWrite('DELETE', '/v1/orgs/o1/anything')).toBe('Removal');
    expect(describeWrite('REPORT', '/v1/orgs/o1/anything')).toBe('Change');
  });
});

describe('isReplayable', () => {
  it('replays a fresh queued entry', () => {
    expect(isReplayable(entry(), NOW)).toBe(true);
  });

  it('never replays an entry that is not waiting', () => {
    expect(isReplayable(entry({ status: 'sending' }), NOW)).toBe(false);
    expect(isReplayable(entry({ status: 'blocked' }), NOW)).toBe(false);
    expect(isReplayable(entry({ status: 'expired' }), NOW)).toBe(false);
  });

  it('stops replaying past the age window', () => {
    expect(isReplayable(entry(), NOW + OUTBOX_MAX_AGE_MS)).toBe(true);
    expect(isReplayable(entry(), NOW + OUTBOX_MAX_AGE_MS + 1)).toBe(false);
  });

  it('stops replaying once the attempt budget is spent', () => {
    expect(isReplayable(entry({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }), NOW)).toBe(true);
    expect(isReplayable(entry({ attempts: OUTBOX_MAX_ATTEMPTS }), NOW)).toBe(false);
  });
});

describe('classifyReplay', () => {
  it('treats any 2xx as accepted', () => {
    expect(classifyReplay(200)).toBe('accepted');
    expect(classifyReplay(201)).toBe('accepted');
    expect(classifyReplay(204)).toBe('accepted');
  });

  it('treats "nothing answered" as still owed', () => {
    expect(classifyReplay(null)).toBe('retry');
  });

  it('retries a server that is temporarily unable, and a rotated session', () => {
    expect(classifyReplay(500)).toBe('retry');
    expect(classifyReplay(503)).toBe('retry');
    expect(classifyReplay(429)).toBe('retry');
    expect(classifyReplay(408)).toBe('retry');
    expect(classifyReplay(425)).toBe('retry');
    // A cookie that rotated while someone was on a train must not destroy their work.
    expect(classifyReplay(401)).toBe('retry');
  });

  it('gives up when the server understood and refused', () => {
    expect(classifyReplay(409)).toBe('refused');
    expect(classifyReplay(422)).toBe('refused');
    expect(classifyReplay(404)).toBe('refused');
    expect(classifyReplay(403)).toBe('refused');
  });
});

describe('afterReplay', () => {
  it('drops an accepted entry from the queue', () => {
    expect(afterReplay(entry(), 'accepted', NOW)).toBeNull();
  });

  it('keeps a retryable entry waiting, counting the attempt', () => {
    const next = afterReplay(entry(), 'retry', NOW);
    expect(next).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('blocks a refused entry immediately — retrying cannot change a refusal', () => {
    expect(afterReplay(entry(), 'refused', NOW)).toMatchObject({ status: 'blocked', attempts: 1 });
  });

  it('blocks an entry that has spent its attempts', () => {
    const next = afterReplay(entry({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }), 'retry', NOW);
    expect(next).toMatchObject({ status: 'blocked', attempts: OUTBOX_MAX_ATTEMPTS });
  });

  it('expires an entry whose window closed while it was retrying', () => {
    const next = afterReplay(entry(), 'retry', NOW + OUTBOX_MAX_AGE_MS + 1);
    expect(next).toMatchObject({ status: 'expired' });
  });
});

describe('expireAged', () => {
  it('marks a queue restored after the window closed, without deleting anything', () => {
    const restored = expireAged([entry()], NOW + OUTBOX_MAX_AGE_MS + 1);
    // Silently dropping someone's change is the one outcome worse than sending it late.
    expect(restored).toHaveLength(1);
    expect(restored[0]?.status).toBe('expired');
  });

  it('re-queues an entry the tab died mid-flight', () => {
    const restored = expireAged([entry({ status: 'sending' })], NOW);
    expect(restored[0]?.status).toBe('queued');
  });

  it('leaves settled entries alone', () => {
    const restored = expireAged([entry({ status: 'blocked' }), entry({ id: 'e2' })], NOW);
    expect(restored.map((item) => item.status)).toEqual(['blocked', 'queued']);
  });
});

describe('counts', () => {
  it('separates what is still owed from what needs a person', () => {
    const queue = [
      entry({ id: 'a', status: 'queued' }),
      entry({ id: 'b', status: 'sending' }),
      entry({ id: 'c', status: 'blocked' }),
      entry({ id: 'd', status: 'expired' }),
    ];
    expect(pendingCount(queue)).toBe(2);
    expect(stalledCount(queue)).toBe(2);
  });
});
