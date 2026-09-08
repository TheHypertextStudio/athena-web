import {
  CONNECTOR_PROVIDER_IDS,
  connectorIdentityProvider,
} from '@docket/connections/provider-catalog-contract';

/** Map a connector to the social identity provider whose grant funds it. */
export function socialProviderForConnector(
  provider: string,
): 'google' | 'github' | 'linear' | 'notion' {
  const connectorProvider = CONNECTOR_PROVIDER_IDS.find((candidate) => candidate === provider);
  return connectorProvider ? connectorIdentityProvider(connectorProvider) : 'google';
}
