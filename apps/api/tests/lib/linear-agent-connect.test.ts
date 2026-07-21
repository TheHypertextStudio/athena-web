import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as LinearAgentConnect from '../../src/lib/linear-agent-connect';

vi.hoisted(() => {
  process.env['LINEAR_AGENT_CLIENT_ID'] = 'agent-client-id';
  process.env['LINEAR_AGENT_CLIENT_SECRET'] = 'agent-client-secret';
  process.env['LINEAR_AGENT_WEBHOOK_SECRET'] = 'agent-webhook-secret';
  process.env['API_URL'] = 'https://api.docket.test';
});

let signLinearAgentInstallState!: typeof LinearAgentConnect.signLinearAgentInstallState;
let verifyLinearAgentInstallState!: typeof LinearAgentConnect.verifyLinearAgentInstallState;
let linearAgentConfigFromEnv!: typeof LinearAgentConnect.linearAgentConfigFromEnv;

beforeAll(async () => {
  ({ signLinearAgentInstallState, verifyLinearAgentInstallState, linearAgentConfigFromEnv } =
    await import('../../src/lib/linear-agent-connect'));
});

describe('linearAgentConfigFromEnv', () => {
  it('resolves the Agent app config, including the internal callback redirect URI', () => {
    expect(linearAgentConfigFromEnv()).toEqual({
      clientId: 'agent-client-id',
      clientSecret: 'agent-client-secret',
      webhookSecret: 'agent-webhook-secret',
      redirectUri: 'https://api.docket.test/internal/integrations/linear-agent/callback',
    });
  });
});

const STATE = { integrationId: 'intg_1', orgId: 'org_1' };
const NOW = 1_750_000_000_000;

describe('Linear Agent install state sign/verify', () => {
  it('round-trips a valid, unexpired state', () => {
    const token = signLinearAgentInstallState(STATE, NOW);
    expect(verifyLinearAgentInstallState(token, NOW + 1000)).toEqual(STATE);
  });

  it('rejects an expired state', () => {
    const token = signLinearAgentInstallState(STATE, NOW);
    // Past the 10-minute TTL.
    expect(verifyLinearAgentInstallState(token, NOW + 11 * 60_000)).toBeNull();
  });

  it('rejects a tampered payload (re-binding to another org)', () => {
    const token = signLinearAgentInstallState(STATE, NOW);
    const sig = token.split('.')[1];
    const forgedPayload = Buffer.from(
      JSON.stringify({ integrationId: 'x', orgId: 'evil', exp: NOW + 60_000 }),
    ).toString('base64url');
    expect(verifyLinearAgentInstallState(`${forgedPayload}.${sig}`, NOW + 1000)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyLinearAgentInstallState('garbage', NOW)).toBeNull();
    expect(verifyLinearAgentInstallState('', NOW)).toBeNull();
  });
});
