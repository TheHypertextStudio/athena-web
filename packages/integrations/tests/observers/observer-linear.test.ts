import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealLinearObserver } from '../../src/observer-linear';

const SECRET = 'whsec_linear_test_secret';
const AT = '2026-06-28T12:00:00.000Z';

/** Sign a body exactly as Linear does: hex HMAC-SHA256 over the raw bytes. */
function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
}

/** A current Linear-Timestamp header value in milliseconds. */
function recentTimestamp(): string {
  return String(Date.now());
}

const observer = new RealLinearObserver({ signingSecret: SECRET });

describe('RealLinearObserver.verifySignature', () => {
  it('accepts a valid signature', () => {
    const body = JSON.stringify({ type: 'Issue', action: 'create' });
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: {
          'linear-signature': sign(body),
          'linear-timestamp': recentTimestamp(),
        },
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'Issue' });
    const sig = sign(body);
    expect(
      observer.verifySignature({
        rawBody: `${body} `,
        headers: { 'linear-signature': sig, 'linear-timestamp': recentTimestamp() },
      }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
  });

  it('rejects a signature of the wrong byte length outright (before the constant-time compare)', () => {
    const body = JSON.stringify({ type: 'Issue' });
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: { 'linear-signature': 'short', 'linear-timestamp': recentTimestamp() },
      }),
    ).toBe(false);
  });

  it('rejects a signature signed with the wrong secret', () => {
    const body = JSON.stringify({ type: 'Issue' });
    const wrong = createHmac('sha256', 'other').update(body, 'utf8').digest('hex');
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: { 'linear-signature': wrong, 'linear-timestamp': recentTimestamp() },
      }),
    ).toBe(false);
  });

  it('rejects a valid signature with a stale timestamp (replay guard)', () => {
    const body = JSON.stringify({ type: 'Issue' });
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: {
          'linear-signature': sign(body),
          'linear-timestamp': String(Date.now() - 61_000),
        },
      }),
    ).toBe(false);
  });
});

describe('RealLinearObserver.route', () => {
  it('extracts workspace, event id, and type', () => {
    const r = observer.route({
      type: 'Issue',
      action: 'create',
      organizationId: 'ws_1',
      data: { id: 'iss_1' },
      webhookTimestamp: 1000,
    });
    expect(r?.externalWorkspaceId).toBe('ws_1');
    expect(r?.eventType).toBe('Issue');
    expect(r?.externalEventId).toBe('Issue:create:iss_1:1000');
  });

  it('returns null for a non-object payload', () => {
    expect(observer.route('nope')).toBeNull();
    expect(observer.route({ action: 'create' })).toBeNull(); // no type
  });

  it('omits externalWorkspaceId when organizationId is absent', () => {
    const r = observer.route({ type: 'Issue', data: { id: 'iss_1' } });
    expect(r).not.toHaveProperty('externalWorkspaceId');
  });

  it('defaults action to "event" and falls back to notification.id, then "" when neither id exists', () => {
    const withNotification = observer.route({
      type: 'AppUserNotification',
      notification: { id: 'n1' },
    });
    expect(withNotification?.externalEventId).toBe('AppUserNotification:event:n1:');

    const withNeither = observer.route({ type: 'Issue' });
    expect(withNeither?.externalEventId).toBe('Issue:event::');
  });

  it('renders webhookTimestamp as "" when it is not a number', () => {
    const r = observer.route({
      type: 'Issue',
      data: { id: 'i1' },
      webhookTimestamp: 'not-a-number',
    });
    expect(r?.externalEventId).toBe('Issue:event:i1:');
  });
});

describe('RealLinearObserver.normalize', () => {
  it('maps an Issue create to a created event with actor + work_item entity + linear.issue detail', () => {
    const drafts = observer.normalize({
      eventType: 'Issue',
      receivedAt: AT,
      payload: {
        type: 'Issue',
        action: 'create',
        organizationId: 'ws',
        createdAt: AT,
        data: {
          id: 'iss_1',
          title: 'Ship it',
          url: 'https://linear.app/x/issue/ABC-1',
          priority: 2,
          state: { name: 'In Progress', type: 'started' },
          assignee: { id: 'u1', name: 'Jane' },
        },
        webhookTimestamp: 5,
      },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('created');
    expect(drafts[0]?.title).toContain('Ship it');
    expect(drafts[0]?.entity).toEqual({
      kind: 'work_item',
      externalId: 'iss_1',
      title: 'Ship it',
      url: 'https://linear.app/x/issue/ABC-1',
    });
    expect(drafts[0]?.actor?.displayName).toBe('Jane');
    expect(drafts[0]?.detail).toEqual({
      schema: 'linear.issue',
      stateName: 'In Progress',
      priority: 2,
    });
    expect(drafts[0]?.dedupeKey).toBe('Issue:create:iss_1:5');
  });

  it('maps a completed Issue update to a completed observation', () => {
    const drafts = observer.normalize({
      eventType: 'Issue',
      receivedAt: AT,
      payload: {
        type: 'Issue',
        action: 'update',
        data: { id: 'iss_2', title: 'Done', state: { type: 'completed' } },
      },
    });
    expect(drafts[0]?.kind).toBe('completed');
  });

  it('maps a non-completed Issue update to a status_change observation', () => {
    const drafts = observer.normalize({
      eventType: 'Issue',
      receivedAt: AT,
      payload: {
        type: 'Issue',
        action: 'update',
        data: { id: 'iss_2a', state: { type: 'started' } },
      },
    });
    expect(drafts[0]?.kind).toBe('status_change');
    expect(drafts[0]?.title).toContain('Updated issue');
  });

  it('omits entity/actor/permalink/externalId and falls back to a default title when the issue data is bare', () => {
    const drafts = observer.normalize({
      eventType: 'Issue',
      receivedAt: AT,
      payload: { type: 'Issue', action: 'create', data: {} },
    });
    expect(drafts[0]?.title).toContain('an issue');
    expect(drafts[0]).not.toHaveProperty('entity');
    expect(drafts[0]).not.toHaveProperty('actor');
    expect(drafts[0]).not.toHaveProperty('permalink');
    expect(drafts[0]).not.toHaveProperty('externalId');
    expect(drafts[0]?.occurredAt).toBe(AT); // no body.createdAt → falls back to receivedAt
  });

  it('maps a Comment create to a comment observation', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: {
        type: 'Comment',
        action: 'create',
        data: {
          id: 'c1',
          body: 'looks good',
          issue: { id: 'iss_1', title: 'Ship it' },
          user: { id: 'u2', name: 'Bob' },
        },
      },
    });
    expect(drafts[0]?.kind).toBe('comment');
    expect(drafts[0]?.summary).toBe('looks good');
    expect(drafts[0]?.entity?.kind).toBe('work_item');
    expect(drafts[0]?.entity?.externalId).toBe('iss_1');
    expect(drafts[0]?.detail?.schema).toBe('generic');
  });

  it('carries the permalink through when the comment has a url', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: {
        type: 'Comment',
        data: { id: 'c1', body: 'ship it', url: 'https://linear.app/x/issue/ABC-1#comment-c1' },
      },
    });
    expect(drafts[0]?.permalink).toBe('https://linear.app/x/issue/ABC-1#comment-c1');
  });

  it('omits summary/entity/actor/permalink/externalId and falls back to a default title when the comment data is bare', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: { type: 'Comment', action: 'create', data: {} },
    });
    expect(drafts[0]?.title).toBe('Commented on an issue');
    expect(drafts[0]).not.toHaveProperty('summary');
    expect(drafts[0]).not.toHaveProperty('entity');
    expect(drafts[0]).not.toHaveProperty('actor');
    expect(drafts[0]).not.toHaveProperty('permalink');
    expect(drafts[0]).not.toHaveProperty('externalId');
  });

  it('maps a Reaction with an actor, id, and emoji', () => {
    const drafts = observer.normalize({
      eventType: 'Reaction',
      receivedAt: AT,
      payload: {
        type: 'Reaction',
        data: { id: 'r1', emoji: '🎉', user: { id: 'u4', name: 'Ada' } },
      },
    });
    expect(drafts[0]?.kind).toBe('reaction');
    expect(drafts[0]?.title).toBe('Reacted 🎉');
    expect(drafts[0]?.actor?.displayName).toBe('Ada');
    expect(drafts[0]?.externalId).toBe('r1');
  });

  it('omits actor/externalId and trims the title when the reaction data is bare (no emoji)', () => {
    const drafts = observer.normalize({
      eventType: 'Reaction',
      receivedAt: AT,
      payload: { type: 'Reaction', data: {} },
    });
    expect(drafts[0]?.title).toBe('Reacted');
    expect(drafts[0]).not.toHaveProperty('actor');
    expect(drafts[0]).not.toHaveProperty('externalId');
  });

  it('maps AppUserNotification issueAssignedToYou to an assignment', () => {
    const drafts = observer.normalize({
      eventType: 'AppUserNotification',
      receivedAt: AT,
      payload: {
        type: 'AppUserNotification',
        notification: {
          id: 'n1',
          type: 'issueAssignedToYou',
          issue: { id: 'iss_3', title: 'Do this', url: 'https://linear.app/x/issue/ABC-3' },
          actor: { id: 'u3', name: 'Lee' },
        },
      },
    });
    expect(drafts[0]?.kind).toBe('assignment');
    expect(drafts[0]?.title).toContain('Do this');
    expect(drafts[0]?.entity?.kind).toBe('work_item');
    expect(drafts[0]?.entity?.externalId).toBe('iss_3');
    expect(drafts[0]?.actor?.displayName).toBe('Lee');
  });

  it('maps AppUserNotification issueMention to a mention', () => {
    const drafts = observer.normalize({
      eventType: 'AppUserNotification',
      receivedAt: AT,
      payload: {
        type: 'AppUserNotification',
        notification: {
          id: 'n2',
          type: 'issueMention',
          issue: { id: 'iss_4', title: 'Look here' },
        },
      },
    });
    expect(drafts[0]?.kind).toBe('mention');
  });

  it('omits entity/actor/permalink/externalId and falls back to a default title when the notification is bare', () => {
    const drafts = observer.normalize({
      eventType: 'AppUserNotification',
      receivedAt: AT,
      payload: { type: 'AppUserNotification', notification: {} },
    });
    expect(drafts[0]?.title).toContain('a Linear item');
    expect(drafts[0]).not.toHaveProperty('entity');
    expect(drafts[0]).not.toHaveProperty('actor');
    expect(drafts[0]).not.toHaveProperty('permalink');
    expect(drafts[0]).not.toHaveProperty('externalId');
  });

  it('falls back through notification.createdAt → body.createdAt → receivedAt', () => {
    const withBodyCreatedAt = observer.normalize({
      eventType: 'AppUserNotification',
      receivedAt: AT,
      payload: {
        type: 'AppUserNotification',
        createdAt: '2026-05-01T00:00:00.000Z',
        notification: { type: 'issueMention', issue: { id: 'i1' } },
      },
    });
    expect(withBodyCreatedAt[0]?.occurredAt).toBe('2026-05-01T00:00:00.000Z');

    const withReceivedAt = observer.normalize({
      eventType: 'AppUserNotification',
      receivedAt: AT,
      payload: { type: 'AppUserNotification', notification: { type: 'issueMention' } },
    });
    expect(withReceivedAt[0]?.occurredAt).toBe(AT);
  });

  it('maps a Project event to a degraded generic draft with a project entity', () => {
    const drafts = observer.normalize({
      eventType: 'Project',
      receivedAt: AT,
      payload: { type: 'Project', action: 'create', data: { id: 'p1', name: 'Q3 launch' } },
    });
    expect(drafts[0]?.kind).toBe('created');
    expect(drafts[0]?.entity).toEqual({ kind: 'project', externalId: 'p1', title: 'Q3 launch' });
  });

  it('maps an unrecognized event type to a degraded generic draft (cycle → cycle entity)', () => {
    const drafts = observer.normalize({
      eventType: 'Cycle',
      receivedAt: AT,
      payload: { type: 'Cycle', action: 'update', data: { id: 'cyc_1', name: 'Sprint 7' } },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('status_change');
    expect(drafts[0]?.entity).toEqual({ kind: 'cycle', externalId: 'cyc_1', title: 'Sprint 7' });
    expect(drafts[0]?.detail).toEqual({
      schema: 'generic',
      title: 'Sprint 7',
      summary: null,
      url: null,
    });
  });

  it('generic: entity is undefined for an event type outside the entity taxonomy (e.g. IssueLabel)', () => {
    const drafts = observer.normalize({
      eventType: 'IssueLabel',
      receivedAt: AT,
      payload: { type: 'IssueLabel', data: { id: 'lbl_1', name: 'bug' } },
    });
    expect(drafts[0]).not.toHaveProperty('entity');
  });

  it('generic: falls back through title → name → "Linear <eventType>", and carries permalink/externalId when present', () => {
    const withUrl = observer.normalize({
      eventType: 'IssueLabel',
      receivedAt: AT,
      payload: {
        type: 'IssueLabel',
        data: { id: 'lbl_2', title: 'Bug label', url: 'https://linear.app/x/label/lbl_2' },
      },
    });
    expect(withUrl[0]?.title).toBe('Bug label');
    expect(withUrl[0]?.permalink).toBe('https://linear.app/x/label/lbl_2');
    expect(withUrl[0]?.externalId).toBe('lbl_2');

    const bareFallback = observer.normalize({
      eventType: 'IssueLabel',
      receivedAt: AT,
      payload: { type: 'IssueLabel', data: {} },
    });
    expect(bareFallback[0]?.title).toBe('Linear IssueLabel');
  });

  it('returns [] for a non-object payload', () => {
    expect(observer.normalize({ eventType: 'Issue', receivedAt: AT, payload: 'nope' })).toEqual([]);
  });

  it('falls back the dedupeKey to receivedAt when the payload carries no own "type" field for route() to key off', () => {
    // `event.eventType` (the caller's routing metadata) and the payload's own `type` field are
    // two different things — a payload missing `type` makes `route(body)` return null even
    // though `normalize` still knows which handler to run from `event.eventType`.
    const drafts = observer.normalize({
      eventType: 'Issue',
      receivedAt: AT,
      payload: { action: 'create', data: { id: 'iss_9' } },
    });
    expect(drafts[0]?.dedupeKey).toBe(`linear:${AT}`);
  });
});

describe('actorFrom (via normalize)', () => {
  it('falls back to displayName when name is absent', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: {
        type: 'Comment',
        data: { id: 'c1', user: { id: 'u1', displayName: 'Grace H' } },
      },
    });
    expect(drafts[0]?.actor).toEqual({ externalId: 'u1', displayName: 'Grace H' });
  });

  it('carries avatarUrl and omits displayName when the actor has neither name nor displayName', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: {
        type: 'Comment',
        data: { id: 'c1', user: { id: 'u1', avatarUrl: 'https://img/u1' } },
      },
    });
    expect(drafts[0]?.actor).toEqual({ externalId: 'u1', avatarUrl: 'https://img/u1' });
  });

  it('omits the actor entirely when the user has no id', () => {
    const drafts = observer.normalize({
      eventType: 'Comment',
      receivedAt: AT,
      payload: { type: 'Comment', data: { id: 'c1', user: { name: 'No id' } } },
    });
    expect(drafts[0]).not.toHaveProperty('actor');
  });
});
