import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  agentSurfaceAdapters,
  agentSurfaceFor,
  type AgentSurfaceProvider,
  type CanonicalAgentActivity,
  type RawWebhook,
} from '../../src/agent-surface-registry';

const now = new Date('2026-08-28T18:30:00.000Z');

function rawWebhook(body: string, headers: RawWebhook['headers']): RawWebhook {
  return { body, headers, receivedAt: now };
}

const responseActivity: CanonicalAgentActivity = {
  id: 'activity-1',
  type: 'response',
  body: { text: 'The work is complete.' },
  approvalStatus: null,
  ephemeral: false,
  updatedAt: now,
};

describe('agent surface registry', () => {
  it('registers every provider with its native capability manifest', () => {
    expect(Object.keys(agentSurfaceAdapters)).toEqual(['linear', 'slack', 'github', 'jira_a2a']);
    expect(agentSurfaceFor('linear').capabilities.approval).toBe('select');
    expect(agentSurfaceFor('slack').capabilities.approval).toBe('buttons');
    expect(agentSurfaceFor('github').capabilities.progress).toBe('check_run');
    expect(agentSurfaceFor('jira_a2a').capabilities.progress).toBe('stream');
  });

  it('keeps provider lookups paired with their generic provider type', () => {
    const provider: AgentSurfaceProvider = 'slack';
    expect(agentSurfaceFor(provider).provider).toBe('slack');
  });

  it('routes a verified delivery before installation loading', () => {
    expect(
      agentSurfaceFor('linear').route({
        deliveryId: 'linear-delivery',
        eventType: 'created',
        payload: {
          action: 'created',
          organizationId: 'linear-workspace',
          webhookTimestamp: now.getTime(),
          agentSession: { id: 'linear-session' },
          actor: { id: 'linear-user' },
        },
      }),
    ).toEqual({ workspaceId: 'linear-workspace' });
    expect(
      agentSurfaceFor('slack').route({
        deliveryId: 'slack-delivery',
        eventType: 'event_callback',
        payload: {
          type: 'event_callback',
          team_id: 'slack-team',
          event_id: 'slack-delivery',
          event: {
            type: 'app_mention',
            user: 'U1',
            text: '<@B1> help',
            channel: 'C1',
            ts: '1.1',
          },
        },
      }),
    ).toEqual({ workspaceId: 'slack-team' });
  });

  it('verifies and normalizes a Linear session start', async () => {
    vi.setSystemTime(now);
    const body = JSON.stringify({
      action: 'created',
      type: 'AgentSessionEvent',
      organizationId: 'linear-workspace',
      webhookTimestamp: now.getTime(),
      agentSession: {
        id: 'linear-session',
        promptContext: 'Fix the failing release.',
        issue: { id: 'issue-1', title: 'Release fails' },
        guidance: ['Do not merge around a failed check.'],
      },
      actor: { id: 'linear-user', email: 'person@example.com', name: 'Person' },
    });
    const signature = createHmac('sha256', 'linear-secret').update(body).digest('hex');

    const verified = await agentSurfaceFor('linear').verify(
      rawWebhook(body, { 'linear-signature': signature }),
      { signingSecret: 'linear-secret' },
    );
    const events = await agentSurfaceFor('linear').normalize(verified, {});

    expect(events).toEqual([
      expect.objectContaining({
        type: 'session_started',
        workspaceId: 'linear-workspace',
        externalSessionId: 'linear-session',
        context: expect.objectContaining({ prompt: 'Fix the failing release.' }),
      }),
    ]);
  });

  it.each([
    ['select', 'approval_selected'],
    ['auth', 'authentication_requested'],
    ['stop', 'stop_requested'],
  ] as const)('normalizes the Linear %s signal', async (signalType, canonicalType) => {
    vi.setSystemTime(now);
    const body = JSON.stringify({
      action: 'prompted',
      organizationId: 'linear-workspace',
      webhookTimestamp: now.getTime(),
      agentSession: { id: 'linear-session' },
      actor: { id: 'linear-user' },
      agentActivity: {
        id: `activity-${signalType}`,
        signal: { type: signalType, value: `${signalType}-token` },
      },
    });
    const signature = createHmac('sha256', 'linear-secret').update(body).digest('hex');
    const adapter = agentSurfaceFor('linear');
    const verified = await adapter.verify(rawWebhook(body, { 'linear-signature': signature }), {
      signingSecret: 'linear-secret',
    });

    await expect(adapter.normalize(verified, {})).resolves.toEqual([
      expect.objectContaining({ type: canonicalType }),
    ]);
  });

  it('verifies and normalizes a Slack app mention', async () => {
    vi.setSystemTime(now);
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: {
        type: 'app_mention',
        user: 'U1',
        text: '<@B1> plan the release',
        channel: 'C1',
        ts: '1724870000.000100',
      },
    });
    const signature = `v0=${createHmac('sha256', 'slack-secret')
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`;

    const verified = await agentSurfaceFor('slack').verify(
      rawWebhook(body, {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      }),
      { signingSecret: 'slack-secret' },
    );
    const events = await agentSurfaceFor('slack').normalize(verified, { botUserId: 'B1' });

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'session_started',
        workspaceId: 'T1',
        externalSessionId: 'C1:1724870000.000100',
        context: expect.objectContaining({ prompt: 'plan the release' }),
      }),
    );
  });

  it('verifies and normalizes a GitHub issue command', async () => {
    const body = JSON.stringify({
      action: 'created',
      installation: { id: 42 },
      repository: { id: 7, full_name: 'hypertext/athena', html_url: 'https://github.test/repo' },
      issue: {
        id: 9,
        number: 12,
        title: 'Release fails',
        body: 'Context',
        html_url: 'https://github.test/repo/issues/12',
      },
      comment: {
        id: 10,
        body: '@athena fix this release',
        html_url: 'https://github.test/repo/issues/12#issuecomment-10',
      },
      sender: { id: 11, login: 'octocat' },
    });
    const signature = `sha256=${createHmac('sha256', 'github-secret').update(body).digest('hex')}`;

    const verified = await agentSurfaceFor('github').verify(
      rawWebhook(body, {
        'x-github-delivery': 'delivery-1',
        'x-github-event': 'issue_comment',
        'x-hub-signature-256': signature,
      }),
      { signingSecret: 'github-secret' },
    );
    const events = await agentSurfaceFor('github').normalize(verified, {
      commandName: 'athena',
    });

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'session_started',
        workspaceId: '42',
        externalSessionId: 'hypertext/athena#12',
        context: expect.objectContaining({ prompt: 'fix this release' }),
      }),
    );
  });

  it('verifies and normalizes a Jira A2A task message', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'request-1',
      method: 'message/send',
      params: {
        taskId: 'task-1',
        contextId: 'site-1',
        metadata: { newSession: true, actorId: 'ari:cloud:identity::user/1' },
        message: { role: 'user', parts: [{ kind: 'text', text: 'Plan the Jira release.' }] },
      },
    });

    const verified = await agentSurfaceFor('jira_a2a').verify(
      rawWebhook(body, {
        authorization: 'Bearer jira-secret',
        'x-request-id': 'request-1',
      }),
      { bearerToken: 'jira-secret', siteId: 'site-1' },
    );
    const events = await agentSurfaceFor('jira_a2a').normalize(verified, {
      contextId: 'site-1',
    });

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'session_started',
        workspaceId: 'site-1',
        externalSessionId: 'task-1',
        context: expect.objectContaining({ prompt: 'Plan the Jira release.' }),
      }),
    );
  });

  it('renders the same canonical response into native provider outputs', () => {
    const context = {
      externalWorkspaceId: 'workspace',
      externalSessionId: 'session',
    };

    expect(
      agentSurfaceFor('linear').render(responseActivity, { ...context, provider: 'linear' }),
    ).toMatchObject({ type: 'response', body: 'The work is complete.' });
    expect(
      agentSurfaceFor('slack').render(responseActivity, { ...context, provider: 'slack' }),
    ).toMatchObject({ text: 'The work is complete.' });
    expect(
      agentSurfaceFor('github').render(responseActivity, { ...context, provider: 'github' }),
    ).toMatchObject({ kind: 'comment', body: 'The work is complete.' });
    expect(
      agentSurfaceFor('jira_a2a').render(responseActivity, { ...context, provider: 'jira_a2a' }),
    ).toMatchObject({ kind: 'message', text: 'The work is complete.' });
  });

  it('renders native approval controls without changing the canonical intent', () => {
    const activity: CanonicalAgentActivity = {
      ...responseActivity,
      type: 'elicitation',
      control: {
        type: 'approval',
        activityId: 'action-1',
        approveToken: 'approve-token',
        rejectToken: 'reject-token',
      },
    };
    const context = { externalWorkspaceId: 'workspace', externalSessionId: 'session' };

    expect(
      agentSurfaceFor('linear').render(activity, { ...context, provider: 'linear' }).signal,
    ).toMatchObject({ type: 'select' });
    expect(
      agentSurfaceFor('slack').render(activity, { ...context, provider: 'slack' }).blocks,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'actions' })]));
    expect(
      agentSurfaceFor('jira_a2a').render(activity, { ...context, provider: 'jira_a2a' }),
    ).toMatchObject({ kind: 'input_required' });
    expect(
      agentSurfaceFor('github').render(activity, { ...context, provider: 'github' }),
    ).toMatchObject({
      kind: 'comment',
      body: expect.stringContaining('/athena approve approve-token'),
    });
  });

  it('renders authentication and stop controls on every provider', () => {
    const context = { externalWorkspaceId: 'workspace', externalSessionId: 'session' };
    const authentication: CanonicalAgentActivity = {
      ...responseActivity,
      type: 'elicitation',
      control: {
        type: 'authentication',
        url: 'https://docket.test/link/token',
        externalActorId: 'external-user',
      },
    };
    const stop: CanonicalAgentActivity = {
      ...responseActivity,
      type: 'elicitation',
      control: { type: 'stop', stopToken: 'stop-token' },
    };

    expect(
      agentSurfaceFor('linear').render(authentication, { ...context, provider: 'linear' }).signal,
    ).toMatchObject({ type: 'auth', url: 'https://docket.test/link/token' });
    expect(
      agentSurfaceFor('slack').render(authentication, { ...context, provider: 'slack' }).blocks,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'actions' })]));
    expect(
      agentSurfaceFor('github').render(authentication, { ...context, provider: 'github' }),
    ).toMatchObject({
      kind: 'comment',
      body: expect.stringContaining('https://docket.test/link/token'),
    });
    expect(
      agentSurfaceFor('jira_a2a').render(authentication, { ...context, provider: 'jira_a2a' }),
    ).toMatchObject({ kind: 'input_required', url: 'https://docket.test/link/token' });

    expect(
      agentSurfaceFor('linear').render(stop, { ...context, provider: 'linear' }).signal,
    ).toMatchObject({ type: 'stop', value: 'stop-token' });
    expect(agentSurfaceFor('slack').render(stop, { ...context, provider: 'slack' }).blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'actions' })]),
    );
    expect(
      agentSurfaceFor('github').render(stop, { ...context, provider: 'github' }),
    ).toMatchObject({ kind: 'comment', body: expect.stringContaining('/athena stop stop-token') });
    expect(
      agentSurfaceFor('jira_a2a').render(stop, { ...context, provider: 'jira_a2a' }),
    ).toMatchObject({
      kind: 'input_required',
      choices: [{ label: 'Stop Athena', value: 'stop-token' }],
    });
  });

  it('rejects stale Slack deliveries before schema normalization', async () => {
    const staleTimestamp = String(Math.floor(now.getTime() / 1_000) - 301);
    const body = JSON.stringify({ type: 'event_callback' });
    const signature = `v0=${createHmac('sha256', 'slack-secret')
      .update(`v0:${staleTimestamp}:${body}`)
      .digest('hex')}`;

    await expect(
      agentSurfaceFor('slack').verify(
        rawWebhook(body, {
          'x-slack-request-timestamp': staleTimestamp,
          'x-slack-signature': signature,
        }),
        { signingSecret: 'slack-secret' },
      ),
    ).rejects.toThrow('missing or stale');
  });
});
