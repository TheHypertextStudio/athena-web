import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealLinearObserver } from '../src/observer-linear';

const SECRET = 'whsec_linear_test_secret';
const AT = '2026-06-28T12:00:00.000Z';

/** Sign a body exactly as Linear does: hex HMAC-SHA256 over the raw bytes. */
function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
}

const observer = new RealLinearObserver({ signingSecret: SECRET });

describe('RealLinearObserver.verifySignature', () => {
  it('accepts a valid signature', () => {
    const body = JSON.stringify({ type: 'Issue', action: 'create' });
    expect(
      observer.verifySignature({ rawBody: body, headers: { 'linear-signature': sign(body) } }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'Issue' });
    const sig = sign(body);
    expect(
      observer.verifySignature({ rawBody: `${body} `, headers: { 'linear-signature': sig } }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
  });

  it('rejects a signature signed with the wrong secret', () => {
    const body = JSON.stringify({ type: 'Issue' });
    const wrong = createHmac('sha256', 'other').update(body, 'utf8').digest('hex');
    expect(
      observer.verifySignature({ rawBody: body, headers: { 'linear-signature': wrong } }),
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

  it('returns [] for a non-object payload', () => {
    expect(observer.normalize({ eventType: 'Issue', receivedAt: AT, payload: 'nope' })).toEqual([]);
  });
});
