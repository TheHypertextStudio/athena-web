/**
 * Tests for the {@link ConnectorProviderClient} capability guards.
 *
 * @remarks
 * These are pure structural (`in`) checks, so they're exercised directly against minimal
 * fake objects rather than through a real provider client — see `connector.test.ts` for the
 * `RealConnector.asWorkGraph()` integration coverage (provider gate + guard together).
 */
import { describe, expect, it } from 'vitest';

import { isWorkGraphProviderClient, type ConnectorProviderClient } from '../src/provider-client';

/** A minimal read-only client satisfying {@link ConnectorProviderClient} and nothing more. */
function baseClient(): ConnectorProviderClient {
  return {
    resolveAccount: async () => undefined,
    importWork: async () => [],
    mirrorStatus: async () => ({ connectionId: 'c1', status: 'idle', itemCount: 0 }),
    resolveExternalUrl: async () => undefined,
    listContainers: async () => [],
  };
}

describe('isWorkGraphProviderClient', () => {
  it('returns true for a client implementing pullWorkGraph/listTeamStates/pushWorkItem', () => {
    const client = {
      ...baseClient(),
      pullWorkGraph: async () => ({ users: [], labels: [], projects: [], cycles: [], items: [] }),
      listTeamStates: async () => [],
      pushWorkItem: async () => ({ externalId: 'w1', externalUpdatedAt: '2026-01-01T00:00:00Z' }),
    };
    expect(isWorkGraphProviderClient(client)).toBe(true);
  });

  it('returns false for a read-only client with no work-graph methods', () => {
    expect(isWorkGraphProviderClient(baseClient())).toBe(false);
  });
});
