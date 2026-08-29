import { ConnectorError } from '@docket/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findLinearAgentIntegration, buildLinearAgentPortForIntegration, agentActivityCreate } =
  vi.hoisted(() => ({
    findLinearAgentIntegration: vi.fn(),
    buildLinearAgentPortForIntegration: vi.fn(),
    agentActivityCreate: vi.fn(),
  }));

vi.mock('../../src/lib/linear-agent-credential', () => ({
  findLinearAgentIntegration,
  buildLinearAgentPortForIntegration,
}));

import {
  ExternalAgentInstallationError,
  publishExternalAgentOutput,
} from '../../src/lib/external-agent-publisher';

const request = {
  provider: 'linear' as const,
  organizationId: '01KY1N724K30F3MCPQMRC7GVD3',
  session: { id: 'linear-session-1' },
  kind: 'activity' as const,
  output: {
    type: 'response' as const,
    body: 'Athena finished the work.',
    ephemeral: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  findLinearAgentIntegration.mockResolvedValue({
    id: 'linear-agent-install-1',
    status: 'connected',
  });
  buildLinearAgentPortForIntegration.mockResolvedValue({
    agentActivityCreate,
    agentSessionUpdate: vi.fn(),
  });
});

describe('Linear external agent publisher', () => {
  it('turns a rejected token refresh into a terminal installation error', async () => {
    buildLinearAgentPortForIntegration.mockRejectedValue(
      new ConnectorError('Linear rejected the refresh token.', {
        provider: 'linear',
        kind: 'auth',
      }),
    );

    await expect(publishExternalAgentOutput(request)).rejects.toBeInstanceOf(
      ExternalAgentInstallationError,
    );
  });

  it('turns a revoked live token into a terminal installation error', async () => {
    agentActivityCreate.mockRejectedValue(
      new ConnectorError('Linear rejected the token.', { provider: 'linear', kind: 'auth' }),
    );

    await expect(publishExternalAgentOutput(request)).rejects.toBeInstanceOf(
      ExternalAgentInstallationError,
    );
  });

  it('leaves a transient provider failure retryable', async () => {
    const failure = new ConnectorError('Linear is unavailable.', {
      provider: 'linear',
      kind: 'provider',
    });
    agentActivityCreate.mockRejectedValue(failure);

    await expect(publishExternalAgentOutput(request)).rejects.toBe(failure);
  });
});
