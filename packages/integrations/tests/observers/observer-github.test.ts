import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealGitHubObserver } from '../../src/observer-github';

const SECRET = 'whsec_github_test_secret';
const RECEIVED_AT = '2026-06-28T12:00:00.000Z';

/** Sign a body exactly as GitHub does: `sha256=` + hex HMAC-SHA256 over the raw bytes. */
function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;
}

const observer = new RealGitHubObserver({ signingSecret: SECRET });

describe('RealGitHubObserver.verifySignature', () => {
  it('accepts a valid X-Hub-Signature-256', () => {
    const body = JSON.stringify({ action: 'opened', issue: { id: 1 } });
    expect(
      observer.verifySignature({ rawBody: body, headers: { 'x-hub-signature-256': sign(body) } }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ action: 'opened', issue: { id: 1 } });
    const sig = sign(body);
    expect(
      observer.verifySignature({ rawBody: `${body} `, headers: { 'x-hub-signature-256': sig } }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
  });

  it('rejects a signature of the wrong byte length outright', () => {
    expect(
      observer.verifySignature({
        rawBody: '{}',
        headers: { 'x-hub-signature-256': 'sha256=short' },
      }),
    ).toBe(false);
  });
});

describe('RealGitHubObserver.route', () => {
  it('routes by installation id and infers the issues event type from the payload shape', () => {
    const r = observer.route({
      action: 'opened',
      issue: { id: 7, updated_at: '2026-06-28T11:00:00Z' },
      installation: { id: 4242 },
    });
    expect(r?.externalWorkspaceId).toBe('4242');
    expect(r?.eventType).toBe('issues');
    expect(r?.externalEventId).toBe('issues:opened:7:2026-06-28T11:00:00Z');
  });

  it('distinguishes an issue comment from a bare issue (comment keys win)', () => {
    const r = observer.route({
      action: 'created',
      issue: { id: 7 },
      comment: { id: 99, updated_at: '2026-06-28T11:30:00Z' },
      installation: { id: 1 },
    });
    expect(r?.eventType).toBe('issue_comment');
    expect(r?.externalEventId).toBe('issue_comment:created:99:2026-06-28T11:30:00Z');
  });

  it('returns null for an unrecognized payload', () => {
    expect(observer.route({ action: 'created', installation: { id: 1 } })).toBeNull();
    expect(observer.route('not-json')).toBeNull();
  });

  it('infers pull_request and pull_request_review_comment event types', () => {
    const pr = observer.route({ action: 'opened', pull_request: { id: 5 } });
    expect(pr?.eventType).toBe('pull_request');

    const prComment = observer.route({
      action: 'created',
      pull_request: { id: 5 },
      comment: { id: 88 },
    });
    expect(prComment?.eventType).toBe('pull_request_review_comment');
  });

  it('defaults action to "event" and omits externalWorkspaceId when installation is absent', () => {
    const r = observer.route({ issue: { id: 7 } });
    expect(r?.externalEventId).toBe('issues:event:7:');
    expect(r).not.toHaveProperty('externalWorkspaceId');
  });

  it('falls back id/updatedAt to "" when the concerned entity has neither', () => {
    const r = observer.route({ action: 'opened', issue: {} });
    expect(r?.externalEventId).toBe('issues:opened::');
  });

  it('prefers the comment, then the PR, then the issue as the concerned entity', () => {
    const commentWins = observer.route({
      action: 'created',
      issue: { id: 'issue-1' },
      comment: { id: 'comment-1' },
    });
    expect(commentWins?.externalEventId).toContain(':comment-1:');

    const prWins = observer.route({ action: 'opened', pull_request: { id: 'pr-1' } });
    expect(prWins?.externalEventId).toContain(':pr-1:');
  });
});

describe('RealGitHubObserver.normalize', () => {
  it('maps a closed issue to a completed event with work_item entity + actor + permalink', () => {
    const payload = {
      action: 'closed',
      issue: {
        id: 7,
        title: 'Fix the bug',
        state: 'closed',
        html_url: 'https://github.com/o/r/issues/7',
        updated_at: '2026-06-28T11:00:00Z',
      },
      sender: { login: 'octocat', avatar_url: 'https://x/a.png' },
      installation: { id: 1 },
    };
    const [obs] = observer.normalize({ eventType: 'issues', payload, receivedAt: RECEIVED_AT });
    expect(obs?.kind).toBe('completed');
    expect(obs?.title).toBe('Closed issue: Fix the bug');
    expect(obs?.occurredAt).toBe('2026-06-28T11:00:00Z');
    expect(obs?.permalink).toBe('https://github.com/o/r/issues/7');
    expect(obs?.entity).toEqual({
      kind: 'work_item',
      externalId: '7',
      title: 'Fix the bug',
      url: 'https://github.com/o/r/issues/7',
    });
    expect(obs?.actor?.externalId).toBe('octocat');
    expect(obs?.actor?.avatarUrl).toBe('https://x/a.png');
    expect(obs?.detail?.schema).toBe('generic');
  });

  it('maps a non-opened, non-closed issue update to a status_change event, with a bare-object fallback title', () => {
    const [obs] = observer.normalize({
      eventType: 'issues',
      payload: { action: 'labeled', issue: {} },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('status_change');
    expect(obs?.title).toBe('Updated issue: an issue');
    expect(obs).not.toHaveProperty('entity');
    expect(obs).not.toHaveProperty('actor');
    expect(obs).not.toHaveProperty('permalink');
    expect(obs).not.toHaveProperty('externalId');
    expect(obs?.occurredAt).toBe(RECEIVED_AT); // no updated_at → falls back to receivedAt
  });

  it('maps an opened issue to a created event', () => {
    const [obs] = observer.normalize({
      eventType: 'issues',
      payload: { action: 'opened', issue: { id: 9 } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('created');
    expect(obs?.title).toBe('Opened issue: an issue');
  });

  it('maps a closed-but-not-merged pull request to a completed event titled "Closed"', () => {
    const [obs] = observer.normalize({
      eventType: 'pull_request',
      payload: { action: 'closed', pull_request: { id: 5, state: 'closed', merged: false } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('completed');
    expect(obs?.title).toBe('Closed PR: a pull request');
  });

  it('maps a still-open pull request update to a status_change event, with a bare-object fallback', () => {
    const [obs] = observer.normalize({
      eventType: 'pull_request',
      payload: { action: 'synchronize', pull_request: {} },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('status_change');
    expect(obs?.title).toBe('Updated PR: a pull request');
    expect(obs).not.toHaveProperty('entity');
    expect(obs).not.toHaveProperty('actor');
    // No `number` on a bare object → the pull_request detail builder declines, generic wins.
    expect(obs?.detail?.schema).toBe('generic');
  });

  it('maps an opened pull request to a created event', () => {
    const [obs] = observer.normalize({
      eventType: 'pull_request',
      payload: { action: 'opened', pull_request: { id: 5 } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('created');
    expect(obs?.title).toBe('Opened PR: a pull request');
  });

  it('maps a merged pull request to a completed event with a github.pull_request detail', () => {
    const payload = {
      action: 'closed',
      pull_request: {
        id: 12,
        number: 12,
        title: 'Add feature',
        state: 'closed',
        merged: true,
        draft: false,
        html_url: 'https://github.com/o/r/pull/12',
      },
      sender: { login: 'octocat' },
      installation: { id: 1 },
    };
    const [obs] = observer.normalize({
      eventType: 'pull_request',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('completed');
    expect(obs?.title).toBe('Merged PR: Add feature');
    expect(obs?.entity?.kind).toBe('work_item');
    expect(obs?.detail).toEqual({
      schema: 'github.pull_request',
      number: 12,
      merged: true,
      draft: false,
    });
  });

  it('maps an issue comment to a comment event carrying the body', () => {
    const payload = {
      action: 'created',
      issue: { id: 7, title: 'Fix the bug', html_url: 'https://github.com/o/r/issues/7' },
      comment: { id: 99, body: 'nice work', user: { login: 'reviewer' } },
      installation: { id: 1 },
    };
    const [obs] = observer.normalize({
      eventType: 'issue_comment',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('comment');
    expect(obs?.title).toBe('Commented on Fix the bug');
    expect(obs?.summary).toBe('nice work');
    expect(obs?.entity?.kind).toBe('work_item');
    expect(obs?.entity?.externalId).toBe('7');
    expect(obs?.actor?.externalId).toBe('reviewer');
    expect(obs?.detail?.schema).toBe('generic');
  });

  it('maps a pull_request_review_comment (comment carries pull_request, not issue)', () => {
    const payload = {
      action: 'created',
      pull_request: { id: 12, title: 'Add feature', html_url: 'https://github.com/o/r/pull/12' },
      comment: { id: 200, body: 'LGTM', user: { login: 'reviewer' } },
    };
    const [obs] = observer.normalize({
      eventType: 'pull_request_review_comment',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('comment');
    expect(obs?.title).toBe('Commented on Add feature');
    expect(obs?.detail?.schema).toBe('generic');
  });

  it("falls back the comment actor to the delivery's sender when the comment carries no user", () => {
    const payload = {
      action: 'created',
      issue: { id: 7 },
      comment: { id: 99, body: 'hi' },
      sender: { login: 'bot-account' },
    };
    const [obs] = observer.normalize({
      eventType: 'issue_comment',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.actor?.externalId).toBe('bot-account');
  });

  it('omits summary/entity/actor/permalink/externalId and falls back to a default title for a bare comment', () => {
    const [obs] = observer.normalize({
      eventType: 'issue_comment',
      payload: { action: 'created', comment: {} },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.title).toBe('Commented on a thread');
    expect(obs).not.toHaveProperty('summary');
    expect(obs).not.toHaveProperty('entity');
    expect(obs).not.toHaveProperty('actor');
    expect(obs).not.toHaveProperty('permalink');
    expect(obs).not.toHaveProperty('externalId');
  });

  it('actorFrom: falls back to a stringified numeric id when the user has no login', () => {
    const [obs] = observer.normalize({
      eventType: 'issues',
      payload: { action: 'opened', issue: { id: 7 }, sender: { id: 555 } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.actor).toEqual({ externalId: '555' });
  });

  it('actorFrom: omits the actor entirely when the sender is absent', () => {
    const [obs] = observer.normalize({
      eventType: 'issues',
      payload: { action: 'opened', issue: { id: 7 } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs).not.toHaveProperty('actor');
  });

  it('ignores an unknown event type (ping/health delivery carries no activity)', () => {
    expect(
      observer.normalize({ eventType: 'unknown', payload: {}, receivedAt: RECEIVED_AT }),
    ).toEqual([]);
  });

  it('returns [] for a non-object payload', () => {
    expect(
      observer.normalize({ eventType: 'issues', payload: 'not-json', receivedAt: RECEIVED_AT }),
    ).toEqual([]);
  });
});
