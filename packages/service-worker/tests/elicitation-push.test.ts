/**
 * The service worker's half of answering Athena from a notification.
 *
 * @remarks
 * The routing decisions are pure functions precisely so they can be asserted without a browser:
 * "this tap records an answer against elicitation X" and "this tap lands on the question in
 * context" are the two behaviours the requirement is about, and both are decisions, not rendering.
 */
import { describe, expect, it } from 'vitest';

import {
  ANSWER_ACTION_PREFIX,
  answerEndpoint,
  readPushPayload,
  resolveNotificationIntent,
} from '../src/worker/elicitation-push';

/** The payload the server actually sends, built the same way `elicitationPushMessage` builds it. */
const PAYLOAD = JSON.stringify({
  title: 'Post the sprint update to the Acme project channel',
  body: 'Should I post it now?\nWeekly sprint update',
  tag: 'elicitation:elc_1',
  url: '/athena?elicitation=elc_1',
  requireInteraction: true,
  urgency: 'high',
  ttlSeconds: 3600,
  actions: [
    { action: `${ANSWER_ACTION_PREFIX}true`, title: 'Post it now' },
    { action: `${ANSWER_ACTION_PREFIX}false`, title: 'Hold until standup' },
  ],
  data: {
    kind: 'elicitation',
    elicitationId: 'elc_1',
    url: '/athena?elicitation=elc_1',
    answerable: true,
  },
});

describe('reading a push message', () => {
  it('reads a real elicitation payload including its action buttons', () => {
    const payload = readPushPayload(PAYLOAD);

    expect(payload).not.toBeNull();
    expect(payload?.title).toBe('Post the sprint update to the Acme project channel');
    expect(payload?.requireInteraction).toBe(true);
    expect(payload?.actions.map((action) => action.title)).toEqual([
      'Post it now',
      'Hold until standup',
    ]);
  });

  it('ignores a message that is not ours rather than showing an empty banner', () => {
    expect(readPushPayload(null)).toBeNull();
    expect(readPushPayload('not json')).toBeNull();
    expect(readPushPayload(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(readPushPayload(JSON.stringify({ title: 'no tag' }))).toBeNull();
  });

  it('drops a malformed action instead of rendering a button that cannot work', () => {
    const payload = readPushPayload(
      JSON.stringify({ title: 't', tag: 'x', actions: [{ action: 'a' }, 'nope', null] }),
    );

    expect(payload?.actions).toEqual([]);
  });
});

describe('deciding what a notification click means', () => {
  it('records the answer the tapped button carries', () => {
    const payload = readPushPayload(PAYLOAD);

    const accept = resolveNotificationIntent(`${ANSWER_ACTION_PREFIX}true`, payload?.data ?? {});
    const decline = resolveNotificationIntent(`${ANSWER_ACTION_PREFIX}false`, payload?.data ?? {});

    expect(accept).toEqual({
      kind: 'answer',
      elicitationId: 'elc_1',
      value: true,
      url: '/athena?elicitation=elc_1',
    });
    expect(decline).toMatchObject({ kind: 'answer', value: false });
  });

  it('carries a selection value, not just a boolean', () => {
    const intent = resolveNotificationIntent(`${ANSWER_ACTION_PREFIX}"ops"`, {
      elicitationId: 'elc_2',
      url: '/athena?elicitation=elc_2',
    });

    expect(intent).toEqual({
      kind: 'answer',
      elicitationId: 'elc_2',
      value: 'ops',
      url: '/athena?elicitation=elc_2',
    });
  });

  it('lands on the question in context when the banner body is clicked', () => {
    const intent = resolveNotificationIntent('', {
      elicitationId: 'elc_1',
      url: '/athena?elicitation=elc_1',
    });

    expect(intent).toEqual({ kind: 'open', url: '/athena?elicitation=elc_1' });
  });

  it('opens rather than guessing when the action id cannot be decoded', () => {
    expect(
      resolveNotificationIntent(`${ANSWER_ACTION_PREFIX}{oops`, {
        elicitationId: 'elc_1',
        url: '/athena?elicitation=elc_1',
      }),
    ).toEqual({ kind: 'open', url: '/athena?elicitation=elc_1' });
  });

  it('falls back to the Athena surface when a notification names no question', () => {
    expect(resolveNotificationIntent('', {})).toEqual({ kind: 'open', url: '/athena' });
  });
});

describe('the answer endpoint', () => {
  it('addresses the same route the in-app card posts to', () => {
    expect(answerEndpoint('https://api.docket.place', 'elc_1')).toBe(
      'https://api.docket.place/v1/me/elicitations/elc_1/answer',
    );
  });

  it('tolerates a trailing slash on the configured origin', () => {
    expect(answerEndpoint('https://api.docket.place/', 'elc_1')).toBe(
      'https://api.docket.place/v1/me/elicitations/elc_1/answer',
    );
  });

  it('escapes an id so a crafted notification cannot reach another route', () => {
    expect(answerEndpoint('https://api.docket.place', '../../admin')).toBe(
      'https://api.docket.place/v1/me/elicitations/..%2F..%2Fadmin/answer',
    );
  });
});
