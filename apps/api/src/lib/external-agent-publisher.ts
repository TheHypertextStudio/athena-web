/** Credential-aware provider publication for Athena's external relay. */
import type { ExternalRef } from '@docket/integrations';

import type { ExternalAgentPublishRequest } from './external-agent-relay';
import {
  buildLinearAgentPortForIntegration,
  findLinearAgentIntegration,
} from './linear-agent-credential';

/** Publish one rendered provider output with the owning installation credential. */
export async function publishExternalAgentOutput(
  request: ExternalAgentPublishRequest,
): Promise<ExternalRef> {
  switch (request.provider) {
    case 'linear': {
      const installed = await findLinearAgentIntegration(request.organizationId);
      if (installed?.status !== 'connected') {
        throw new Error('Linear Agent installation is unavailable.');
      }
      const port = await buildLinearAgentPortForIntegration(installed.id);
      if (!port) throw new Error('Linear Agent credential is unavailable.');
      if (request.kind === 'prepare_session') {
        await port.agentSessionUpdate({
          agentSessionId: request.session.id,
          externalUrls: [{ label: 'Open in Docket', url: request.externalUrl }],
        });
        return { id: request.session.id, url: request.externalUrl };
      }
      const { output } = request;
      return port.agentActivityCreate({
        agentSessionId: request.session.id,
        type: output.type,
        body: output.body,
        ...(output.ephemeral !== undefined ? { ephemeral: output.ephemeral } : {}),
        ...(output.signal?.type === 'select'
          ? {
              signal: 'select',
              signalMetadata: { options: output.signal.options },
            }
          : output.signal?.type === 'auth'
            ? {
                signal: 'auth',
                signalMetadata: { url: output.signal.url, providerName: 'Docket' },
              }
            : {}),
      });
    }
    case 'slack':
    case 'github':
    case 'jira_a2a':
      throw new Error(`${request.provider} external agent publication is not enabled.`);
  }
}
