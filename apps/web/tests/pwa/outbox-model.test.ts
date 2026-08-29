import { describe, expect, it } from 'vitest';

import {
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
  afterReplay,
  classifyReplay,
  describeWrite,
  expireAged,
  hasCompleteReplayContract,
  isQueueableWrite,
  isManualRetryable,
  isReplayable,
  pendingCount,
  retryAfterTimestamp,
  sanitizeReplayHeaders,
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
  const commandId = 'command-1';
  return {
    id: 'e1',
    userId: 'u1',
    epoch: 'legacy',
    method: 'POST',
    path: '/v1/orgs/o1/object-commands',
    body: JSON.stringify({ commandId }),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId },
    label: 'Object change',
    createdAt: NOW,
    notBeforeAt: null,
    attempts: 0,
    status: 'queued',
    ...overrides,
  };
}

describe('isQueueableWrite', () => {
  it('takes responsibility only for atomically idempotent object commands', () => {
    expect(isQueueableWrite('POST', '/v1/orgs/o1/object-commands')).toBe(true);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/tasks')).toBe(false);
    expect(isQueueableWrite('PATCH', '/v1/orgs/o1/tasks/t1')).toBe(false);
    expect(isQueueableWrite('DELETE', '/v1/orgs/o1/tasks/t1')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/comments')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/projects')).toBe(false);
    expect(isQueueableWrite('PATCH', '/v1/orgs/o1/projects/p1')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/initiatives/hierarchy-links')).toBe(false);
    expect(isQueueableWrite('PATCH', '/v1/orgs/o1/initiatives/hierarchy-links/l1')).toBe(false);
    expect(isQueueableWrite('DELETE', '/v1/orgs/o1/initiatives/hierarchy-links/l1')).toBe(false);
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

  it('rejects sensitive and response-dependent writes before the live attempt', () => {
    expect(isQueueableWrite('POST', '/v1/me/recovery-codes')).toBe(false);
    expect(isQueueableWrite('DELETE', '/v1/me')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/account/delete')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/billing/checkout')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/billing/checkout')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/object-commands/replay-access')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/labels')).toBe(false);
    expect(isQueueableWrite('PUT', '/v1/orgs/o1/tasks/t1')).toBe(false);
    expect(isQueueableWrite('CONNECT', '/v1/orgs/o1/tasks/t1')).toBe(false);
  });

  it('ignores anything outside the typed API', () => {
    expect(isQueueableWrite('POST', '/some/other/thing')).toBe(false);
    expect(isQueueableWrite('POST', '/v1x/orgs')).toBe(false);
    expect(isQueueableWrite('POST', '')).toBe(false);
    expect(isQueueableWrite('POST', 'https://outside.test/v1/orgs/o1/tasks')).toBe(false);
    expect(isQueueableWrite('POST', '//outside.test/v1/orgs/o1/tasks')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/../api/auth/sign-out')).toBe(false);
    expect(isQueueableWrite('POST', '/v1/orgs/o1/tasks#fragment')).toBe(false);
  });
});

describe('describeWrite', () => {
  it('names the change in the product’s own words', () => {
    expect(describeWrite('POST', '/v1/orgs/o1/object-commands')).toBe('Object change');
  });

  it('still says something human for a write it has no rule for', () => {
    // A pending-change list must never show a raw URL, and must never be empty.
    expect(describeWrite('POST', '/v1/orgs/o1/labels')).toBe('New item');
    expect(describeWrite('PUT', '/v1/orgs/o1/anything')).toBe('Change');
    expect(describeWrite('DELETE', '/v1/orgs/o1/anything')).toBe('Removal');
    expect(describeWrite('REPORT', '/v1/orgs/o1/anything')).toBe('Change');
  });
});

describe('replay contract headers', () => {
  it('keeps only the object-command contract and rejects unsafe values and secrets', () => {
    expect(
      sanitizeReplayHeaders({
        Authorization: 'Bearer private',
        Cookie: 'private=1',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'stable-key',
        'If-Match': '"must-not-persist"',
        'X-Docket-Replay-Owner': 'must-not-persist',
        'X-Secret': 'private',
      }),
    ).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'stable-key',
    });
    expect(sanitizeReplayHeaders({ 'If-Match': 'bad\r\nInjected: yes' })).toEqual({});
  });

  it('requires an object command key that matches the stable command id', () => {
    expect(
      hasCompleteReplayContract(
        entry({
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ).toBe(false);
    expect(
      hasCompleteReplayContract(
        entry({
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'wrong-command',
          },
        }),
      ),
    ).toBe(false);
    expect(hasCompleteReplayContract(entry())).toBe(true);
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

  it('does not spend another attempt before the persisted server deadline', () => {
    expect(isReplayable(entry({ notBeforeAt: NOW + 60_000 }), NOW + 59_999)).toBe(false);
    expect(isReplayable(entry({ notBeforeAt: NOW + 60_000 }), NOW + 60_000)).toBe(true);
  });
});

describe('retryAfterTimestamp', () => {
  it('parses delta seconds and an HTTP date into a bounded deadline', () => {
    expect(retryAfterTimestamp('120', NOW)).toBe(NOW + 120_000);
    expect(retryAfterTimestamp(new Date(NOW + 120_000).toUTCString(), NOW)).toBe(NOW + 120_000);
    expect(retryAfterTimestamp(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(NOW);
  });

  it('rejects malformed, negative, injected, and overflowing values', () => {
    expect(retryAfterTimestamp('', NOW)).toBeNull();
    expect(retryAfterTimestamp('-1', NOW)).toBeNull();
    expect(retryAfterTimestamp('tomorrow', NOW)).toBeNull();
    expect(retryAfterTimestamp('1\r\nX-Injected: yes', NOW)).toBeNull();
    expect(retryAfterTimestamp('999999999999999999999999', NOW)).toBeNull();
  });
});

describe('classifyReplay', () => {
  it('treats any 2xx as accepted', () => {
    expect(classifyReplay('POST', 200)).toBe('accepted');
    expect(classifyReplay('POST', 201)).toBe('accepted');
    expect(classifyReplay('POST', 204)).toBe('accepted');
  });

  it('pauses when nothing answered or the session needs confirmation', () => {
    expect(classifyReplay('POST', null)).toBe('pause');
    expect(classifyReplay('POST', 401)).toBe('pause');
  });

  it('distinguishes transient server failures from in-progress contention', () => {
    expect(classifyReplay('POST', 500)).toBe('retry');
    expect(classifyReplay('POST', 503)).toBe('retry');
    expect(classifyReplay('POST', 429)).toBe('retry');
    expect(classifyReplay('POST', 408)).toBe('retry');
    expect(classifyReplay('POST', 425)).toBe('retry');
    expect(classifyReplay('POST', 409, NOW + 1_000)).toBe('deferred');
  });

  it('gives up when the server understood and refused', () => {
    expect(classifyReplay('POST', 409)).toBe('refused');
    expect(classifyReplay('POST', 422)).toBe('refused');
    expect(classifyReplay('POST', 403)).toBe('refused');
    expect(classifyReplay('PATCH', 200)).toBe('refused');
  });
});

describe('afterReplay', () => {
  it('drops an accepted entry from the queue', () => {
    expect(afterReplay(entry(), 'accepted', NOW)).toBeNull();
  });

  it('keeps a retryable entry waiting, counting the attempt', () => {
    const next = afterReplay(entry(), 'retry', NOW, NOW + 120_000);
    expect(next).toMatchObject({ status: 'queued', attempts: 1, notBeforeAt: NOW + 120_000 });
  });

  it('defers an in-progress key without spending an attempt', () => {
    const next = afterReplay(entry({ attempts: 4 }), 'deferred', NOW, NOW + 1_000);
    expect(next).toMatchObject({ status: 'queued', attempts: 4, notBeforeAt: NOW + 1_000 });
  });

  it('keeps a paused entry waiting without spending an attempt', () => {
    const next = afterReplay(entry({ status: 'sending', attempts: 4 }), 'pause', NOW + 1);
    expect(next).toMatchObject({ status: 'queued', attempts: 4 });
  });

  it('blocks a refused entry immediately — retrying cannot change a refusal', () => {
    expect(afterReplay(entry(), 'refused', NOW)).toMatchObject({ status: 'blocked', attempts: 1 });
  });

  it('blocks an entry that has spent its attempts', () => {
    const next = afterReplay(
      entry({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }),
      'retry',
      NOW,
      NOW + 60_000,
    );
    expect(next).toMatchObject({
      status: 'blocked',
      attempts: OUTBOX_MAX_ATTEMPTS,
      notBeforeAt: NOW + 60_000,
    });
  });

  it('expires an entry whose window closed while it was retrying', () => {
    const next = afterReplay(entry(), 'retry', NOW + OUTBOX_MAX_AGE_MS + 1);
    expect(next).toMatchObject({ status: 'expired' });
  });
});

describe('isManualRetryable', () => {
  it('keeps a blocked entry paced until the server deadline passes', () => {
    const blocked = entry({ status: 'blocked', notBeforeAt: NOW + 60_000 });
    expect(isManualRetryable(blocked, NOW + 59_999)).toBe(false);
    expect(isManualRetryable(blocked, NOW + 60_000)).toBe(true);
  });

  it('rejects expired and non-blocked entries', () => {
    expect(isManualRetryable(entry({ status: 'queued' }), NOW)).toBe(false);
    expect(
      isManualRetryable(entry({ status: 'blocked', createdAt: NOW - OUTBOX_MAX_AGE_MS - 1 }), NOW),
    ).toBe(false);
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

  it('expires a blocked POST once its stable key passes the retention deadline', () => {
    const restored = expireAged(
      [entry({ status: 'blocked', createdAt: NOW - OUTBOX_MAX_AGE_MS - 1 })],
      NOW,
    );
    expect(restored[0]?.status).toBe('expired');
  });

  it('leaves still-young settled entries alone', () => {
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
