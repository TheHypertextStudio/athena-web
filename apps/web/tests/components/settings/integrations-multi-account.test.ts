import type { IdentityOut, IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  availableLinearAccounts,
  groupDirectoryByCategory,
  visibleProviderConnections,
} from '../../../src/components/settings/integrations-selectors';

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

/** Minimal directory-provider fixture for the grouping selector. */
function directoryProvider(
  provider: string,
  pattern: IntegrationDirectoryProvider['pattern'],
  category: string,
): IntegrationDirectoryProvider {
  return { provider, pattern, category } as IntegrationDirectoryProvider;
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

describe('groupDirectoryByCategory', () => {
  const directory = [
    directoryProvider('gmail', 'connector', 'communication'),
    directoryProvider('calendar', 'connector', 'communication'),
    directoryProvider('linear', 'connector', 'project-management'),
    directoryProvider('asana', 'migration', 'project-management'),
    directoryProvider('hidden', 'connector', 'engineering'),
  ];
  const visibleAll = () => true;

  it('keeps only the requested pattern and groups by category in first-seen order', () => {
    const result = groupDirectoryByCategory(directory, 'connector', visibleAll);

    expect(result.map((g) => g.category)).toEqual([
      'communication',
      'project-management',
      'engineering',
    ]);
    expect(result[0]?.providers.map((p) => p.provider)).toEqual(['gmail', 'calendar']);
    // The migration-pattern 'asana' is excluded from a connector grouping.
    expect(result[1]?.providers.map((p) => p.provider)).toEqual(['linear']);
  });

  it('selects the migration pattern independently of the connector one', () => {
    const result = groupDirectoryByCategory(directory, 'migration', visibleAll);

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('project-management');
    expect(result[0]?.providers.map((p) => p.provider)).toEqual(['asana']);
  });

  it('drops providers the caller marks not visible, and empties a category left with none', () => {
    const result = groupDirectoryByCategory(
      directory,
      'connector',
      (provider) => provider !== 'hidden',
    );

    // 'engineering' held only the hidden provider, so it never becomes a group.
    expect(result.map((g) => g.category)).toEqual(['communication', 'project-management']);
  });
});
