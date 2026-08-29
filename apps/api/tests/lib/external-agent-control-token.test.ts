import { beforeEach, describe, expect, it } from 'vitest';

import {
  signExternalAgentControl,
  verifyExternalAgentControl,
} from '../../src/lib/external-agent-control-token';

describe('external agent control tokens', () => {
  beforeEach(() => {
    process.env['BETTER_AUTH_SECRET'] = 'external-agent-control-test-secret';
  });

  it('round-trips a scoped approval and rejects tampering and expiry', () => {
    const token = signExternalAgentControl(
      {
        kind: 'approval',
        provider: 'linear',
        organizationId: 'organization-1',
        sessionId: 'session-1',
        activityId: 'activity-1',
        decision: 'approve',
      },
      1_000,
    );

    expect(verifyExternalAgentControl(token, 1_001)).toEqual({
      kind: 'approval',
      provider: 'linear',
      organizationId: 'organization-1',
      sessionId: 'session-1',
      activityId: 'activity-1',
      decision: 'approve',
    });
    expect(verifyExternalAgentControl(`${token}x`, 1_001)).toBeNull();
    expect(verifyExternalAgentControl(token, 1_000 + 8 * 24 * 60 * 60_000)).toBeNull();
  });
});
