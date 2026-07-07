import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealGitHubObserver } from '../src/observer-github';

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

  it('ignores an unknown event type (ping/health delivery carries no activity)', () => {
    expect(
      observer.normalize({ eventType: 'unknown', payload: {}, receivedAt: RECEIVED_AT }),
    ).toEqual([]);
  });
});
