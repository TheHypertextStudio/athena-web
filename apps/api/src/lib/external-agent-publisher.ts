/** Credential-aware provider publication for Athena's external relay. */
import {
  isAgentSurfaceProvider,
  type AgentSurfaceProvider,
  type ExternalRef,
} from '@docket/integrations';

import type { ExternalAgentPublishRequest } from './external-agent-relay';
import {
  buildLinearAgentPortForIntegration,
  findLinearAgentIntegration,
} from './linear-agent-credential';

/** Stable failure raised when a provider install cannot publish until a human reconnects it. */
export class ExternalAgentInstallationError extends Error {
  readonly code = 'external_agent_installation_unavailable';

  constructor(readonly provider: AgentSurfaceProvider) {
    super('The external agent installation must be reconnected.');
    this.name = 'ExternalAgentInstallationError';
  }
}

/** Whether an outbound failure requires reconnection rather than a timed retry. */
export function isExternalAgentInstallationError(
  error: unknown,
): error is ExternalAgentInstallationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'external_agent_installation_unavailable' &&
    typeof Reflect.get(error, 'provider') === 'string' &&
    isAgentSurfaceProvider(Reflect.get(error, 'provider') as string)
  );
}

type ExternalAgentPublicationHandler<P extends AgentSurfaceProvider> = (
  request: ExternalAgentPublishRequest<P>,
) => Promise<ExternalRef>;

type ExternalAgentPublicationRegistry = {
  readonly [P in AgentSurfaceProvider]: ExternalAgentPublicationHandler<P>;
};

async function publishLinear(request: ExternalAgentPublishRequest<'linear'>): Promise<ExternalRef> {
  const installed = await findLinearAgentIntegration(request.organizationId);
  if (installed?.status !== 'connected') {
    throw new ExternalAgentInstallationError('linear');
  }
  const port = await buildLinearAgentPortForIntegration(installed.id);
  if (!port) throw new ExternalAgentInstallationError('linear');
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
            signalMetadata: {
              url: output.signal.url,
              userId: output.signal.userId,
              providerName: 'Docket',
            },
          }
        : {}),
  });
}

function disabledPublisher<P extends Exclude<AgentSurfaceProvider, 'linear'>>(
  provider: P,
): ExternalAgentPublicationHandler<P> {
  return async () => {
    throw new Error(`${provider} external agent publication is not enabled.`);
  };
}

const externalAgentPublicationHandlers = {
  linear: publishLinear,
  slack: disabledPublisher('slack'),
  github: disabledPublisher('github'),
  jira_a2a: disabledPublisher('jira_a2a'),
} satisfies ExternalAgentPublicationRegistry;

/** Publish one rendered provider output with the owning installation credential. */
export async function publishExternalAgentOutput<P extends AgentSurfaceProvider>(
  request: ExternalAgentPublishRequest<P>,
): Promise<ExternalRef> {
  const handler = externalAgentPublicationHandlers[
    request.provider
  ] as ExternalAgentPublicationHandler<P>;
  return handler(request);
}
