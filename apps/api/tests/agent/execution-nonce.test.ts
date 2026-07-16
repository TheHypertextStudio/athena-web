import { executionRequestNonce } from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { claimExecutionNonce } from '../../src/agent/execution-nonce';
import { getMigratedDb } from '../support/db';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;

beforeAll(async () => {
  dbModule = await getMigratedDb();
});

afterAll(async () => {
  await dbModule.db
    .delete(executionRequestNonce)
    .where(eq(executionRequestNonce.nonce, 'api-nonce-1'));
});

describe('execution nonce claim', () => {
  it('atomically accepts the first request and rejects its replay', async () => {
    const expiresAt = new Date(Date.now() + 300_000);

    await expect(
      claimExecutionNonce('cloudflare_to_docket', 'api-nonce-1', expiresAt),
    ).resolves.toBe(true);
    await expect(
      claimExecutionNonce('cloudflare_to_docket', 'api-nonce-1', expiresAt),
    ).resolves.toBe(false);
  });
});
