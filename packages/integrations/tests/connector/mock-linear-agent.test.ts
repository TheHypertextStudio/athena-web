/**
 * `MockLinearAgent` — the offline double for the Linear Agent platform boundary. No branches:
 * every method is a deterministic record-and-return, so these tests prove the recorded shape
 * and the id counter rather than any decision logic.
 */
import { describe, expect, it } from 'vitest';

import { MockLinearAgent } from '../../src/mock-linear-agent';

describe('MockLinearAgent.exchangeLinearAgentCode / refreshLinearAgentToken', () => {
  it('returns a deterministic fake Bearer token pair, ignoring the input', async () => {
    const agent = new MockLinearAgent();
    const tokens = await agent.exchangeLinearAgentCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://x/callback',
      code: 'auth_code',
    });
    expect(tokens).toEqual({
      accessToken: 'mock-linear-agent-token_000001',
      tokenType: 'Bearer',
      expiresIn: 86_400,
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'mock-linear-agent-refresh_000002',
    });
  });

  it('mints a fresh pair on refresh, continuing the shared counter', async () => {
    const agent = new MockLinearAgent();
    await agent.exchangeLinearAgentCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://x/callback',
      code: 'auth_code',
    });
    const refreshed = await agent.refreshLinearAgentToken({
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'old_refresh',
    });
    expect(refreshed.accessToken).toBe('mock-linear-agent-token_000003');
    expect(refreshed.refreshToken).toBe('mock-linear-agent-refresh_000004');
  });
});

describe('MockLinearAgent.agentActivityCreate', () => {
  it('records the activity and returns a deterministic fake id', async () => {
    const agent = new MockLinearAgent();
    const result = await agent.agentActivityCreate({
      agentSessionId: 'sess_1',
      type: 'thought',
      body: 'Looking into it…',
    });
    expect(result).toEqual({ id: 'mock-linear-activity_000001' });
    expect(agent.activityLog).toEqual([
      {
        agentSessionId: 'sess_1',
        type: 'thought',
        body: 'Looking into it…',
        id: 'mock-linear-activity_000001',
      },
    ]);
  });

  it('appends to the log across multiple calls, in call order', async () => {
    const agent = new MockLinearAgent();
    await agent.agentActivityCreate({ agentSessionId: 's1', type: 'thought', body: 'one' });
    await agent.agentActivityCreate({ agentSessionId: 's1', type: 'response', body: 'two' });
    expect(agent.activityLog.map((a) => a.body)).toEqual(['one', 'two']);
  });
});

describe('MockLinearAgent.agentSessionUpdate', () => {
  it('records the call onto sessionUpdateLog and resolves undefined', async () => {
    const agent = new MockLinearAgent();
    await expect(
      agent.agentSessionUpdate({
        agentSessionId: 'sess_1',
        externalUrls: [{ url: 'https://docket.app/t/1', label: 'Task' }],
      }),
    ).resolves.toBeUndefined();
    expect(agent.sessionUpdateLog).toEqual([
      {
        agentSessionId: 'sess_1',
        externalUrls: [{ url: 'https://docket.app/t/1', label: 'Task' }],
      },
    ]);
  });
});
