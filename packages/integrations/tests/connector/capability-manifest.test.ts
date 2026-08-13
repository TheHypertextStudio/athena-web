import { ACTIVITY_PROVIDER_IDS, PROVIDER_CATALOG } from '@docket/types';
import { describe, expect, it } from 'vitest';

import type { ConnectorProvider } from '../../src/connector';
import { WRITE_BACK_CAPABLE_PROVIDERS } from '../../src/connector';
import { MAIL_CAPABLE_PROVIDERS } from '../../src/mail';
import { PROVIDER_CLIENT_FACTORIES } from '../../src/real-connector';
import {
  isActivitySourceProviderClient,
  isMailActionsProviderClient,
  isWritableProviderClient,
} from '../../src/provider-client';
import type { ProviderHttp } from '../../src/provider-http';

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

  it.each(providers)(
    "%s: activity capability agrees with the catalog's activity flag",
    (provider) => {
      // Unlike the two above, the declaration lives in `PROVIDER_CATALOG` rather than in a manifest
      // local to this package — provider capabilities belong in one place, and the catalog is
      // already where `connector` and `webhook` are declared.
      const client = PROVIDER_CLIENT_FACTORIES[provider](inertHttp);
      expect(isActivitySourceProviderClient(client)).toBe(PROVIDER_CATALOG[provider].activity);
    },
  );

  it('keeps the catalog flag and the activity id list from drifting apart', () => {
    const flagged = Object.values(PROVIDER_CATALOG)
      .filter((entry) => entry.activity)
      .map((entry) => entry.id)
      .sort();
    expect(flagged).toEqual([...ACTIVITY_PROVIDER_IDS].sort());
  });

  it('polls only providers that can carry a source badge', () => {
    // A canonical event with no source system cannot be attributed to anything, so a provider that
    // has none (Google Tasks) must never be polled for activity however capable its client is.
    for (const id of ACTIVITY_PROVIDER_IDS) {
      expect(PROVIDER_CATALOG[id].sourceSystem).not.toBeNull();
    }
  });
});
