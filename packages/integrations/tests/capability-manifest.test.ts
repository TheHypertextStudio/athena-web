import { describe, expect, it } from 'vitest';

import type { ConnectorProvider } from '../src/connector';
import { WRITE_BACK_CAPABLE_PROVIDERS } from '../src/connector';
import { MAIL_CAPABLE_PROVIDERS } from '../src/mail';
import { PROVIDER_CLIENT_FACTORIES } from '../src/real-connector';
import {
  isMailActionsProviderClient,
  isWritableProviderClient,
} from '../src/provider-client';
import type { ProviderHttp } from '../src/provider-http';

/**
 * The tripwire that keeps the declarative capability manifests (consumed by the mock
 * connector and app-layer gating) in lockstep with the real clients' structural shape
 * (consumed by the connector's capability discovery). If a provider client gains or loses
 * a capability interface without the manifest moving — or vice versa — this fails.
 */
describe('capability manifests ⇔ structural provider-client shape', () => {
  const inertHttp = {} as ProviderHttp; // construction only — no request is ever issued

  const providers = Object.keys(PROVIDER_CLIENT_FACTORIES) as ConnectorProvider[];

  it.each(providers)('%s: mail capability agrees with MAIL_CAPABLE_PROVIDERS', (provider) => {
    const client = PROVIDER_CLIENT_FACTORIES[provider](inertHttp);
    expect(isMailActionsProviderClient(client)).toBe(MAIL_CAPABLE_PROVIDERS.has(provider));
  });

  it.each(providers)(
    '%s: write-back capability agrees with WRITE_BACK_CAPABLE_PROVIDERS',
    (provider) => {
      const client = PROVIDER_CLIENT_FACTORIES[provider](inertHttp);
      expect(isWritableProviderClient(client)).toBe(WRITE_BACK_CAPABLE_PROVIDERS.has(provider));
    },
  );
});
