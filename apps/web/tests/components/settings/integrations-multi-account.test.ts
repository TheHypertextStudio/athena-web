import type { IdentityOut, IntegrationOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  availableLinearAccounts,
  visibleProviderConnections,
} from '../../../src/components/settings/integrations-tab';

/** Minimal connection fixture for the pure settings selectors. */
function connection(
  id: string,
  provider: string,
  externalAccountId: string | null,
): IntegrationOut {
  return { id, provider, externalAccountId } as IntegrationOut;
}

/** Minimal linked-identity fixture for the pure settings selectors. */
function identity(accountId: string, provider: IdentityOut['provider']): IdentityOut {
  return { accountId, provider } as IdentityOut;
}

describe('multi-account integration settings selectors', () => {
  it('keeps every Linear connection visible instead of collapsing to the first row', () => {
    const rows = [
      connection('int-one', 'linear', 'lin-one'),
      connection('int-two', 'linear', 'lin-two'),
    ];

    expect(visibleProviderConnections('linear', rows)).toEqual(rows);
    expect(visibleProviderConnections('github', [])).toEqual([undefined]);
  });

  it('offers each unbound Linear identity while excluding accounts already connected', () => {
    const identities = [
      identity('lin-one', 'linear'),
      identity('lin-two', 'linear'),
      identity('gh-one', 'github'),
    ];
    const connections = [connection('int-one', 'linear', 'lin-one')];

    expect(availableLinearAccounts(identities, connections)).toEqual([identities[1]]);
  });
});
