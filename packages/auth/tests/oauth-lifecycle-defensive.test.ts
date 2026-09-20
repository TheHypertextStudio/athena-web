import type * as DocketDbModule from '@docket/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock('@docket/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DocketDbModule>()),
  db: database,
}));

import { ensureTrustedLegacyMcpGrant } from '../src/oauth-lifecycle';

const NOW = new Date('2026-09-12T12:05:00.000Z');
const CUTOFF = new Date('2026-09-12T12:10:00.000Z');
const INPUT = {
  clientId: 'client_1',
  userId: 'user_1',
  issuedAtSeconds: Math.floor(NOW.getTime() / 1_000),
  expiresAtSeconds: Math.floor(NOW.getTime() / 1_000) + 300,
  mcpResource: 'https://api.clearthedocket.com/mcp',
  now: NOW,
};
const CLIENT = {
  clientId: 'client_1',
  disabled: false,
  skipConsent: true,
  legacyBefore: CUTOFF,
  legacyTrusted: true,
};

function transactionWith(selectResults: unknown[][]) {
  const pending = [...selectResults];
  const transaction = {
    select: vi.fn(() => {
      const result = pending.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        for: async () => result,
        limit: async () => result,
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain = {
        values: () => chain,
        onConflictDoNothing: async () => undefined,
      };
      return chain;
    }),
  };
  database.transaction.mockImplementationOnce(async (callback) => callback(transaction));
  return transaction;
}

describe('OAuth lifecycle defensive settlement', () => {
  beforeEach(() => {
    database.transaction.mockReset();
  });

  it('rejects an adapter result whose one-row client slot is empty', async () => {
    transactionWith([[undefined]]);

    await expect(ensureTrustedLegacyMcpGrant(INPUT)).resolves.toBeNull();
  });

  it('rejects an adapter result whose one-row grant slot is empty', async () => {
    transactionWith([[CLIENT], [undefined]]);

    await expect(ensureTrustedLegacyMcpGrant(INPUT)).resolves.toBeNull();
  });

  it('rejects multiple legacy rows even if the storage uniqueness invariant is broken', async () => {
    transactionWith([[CLIENT], [{ id: 'grant_1' }, { id: 'grant_2' }]]);

    await expect(ensureTrustedLegacyMcpGrant(INPUT)).resolves.toBeNull();
  });

  it.each([
    ['no inserted row', []],
    ['an empty inserted row', [undefined]],
  ])('fails closed after a raced insert returns %s', async (_label, rows) => {
    transactionWith([[CLIENT], [], [{ id: 'user_1' }], [], [], rows]);

    await expect(ensureTrustedLegacyMcpGrant(INPUT)).resolves.toBeNull();
  });
});
