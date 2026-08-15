/**
 * `searchExternalMentions` — the branches only a fake {@link ConnectorGateway} can reach.
 *
 * @remarks
 * `mention-external.test.ts` drives the real gateway against seeded connections, which only ever
 * takes the `ok` and `not_searchable` paths — a fixture connector doesn't fail or time out. The
 * port exists specifically so failure and its remediation category can be tested without a real
 * provider outage: `needs_reauth`, `not_connected`, a search that throws a `ConnectorError`, one
 * that times out, and the fallback classification for an error that is neither. Also covered here:
 * de-duplication across two sources returning the same resource, and that one gateway rejection
 * cannot empty the menu for every other source.
 *
 * A connection still has to exist in the database — `searchExternalMentions` checks that before it
 * ever calls the gateway — so every case seeds one and substitutes the gateway for what happens
 * after.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { ConnectorError } from '@docket/integrations';
import type { ExternalResource, ResourceSearch } from '@docket/integrations';

import type { ConnectorAccessResult, ConnectorGateway } from '../../src/content/connector-gateway';
import { searchExternalMentions } from '../../src/content/mention-external';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Seed a connected integration, since the function checks the database before the gateway. */
async function seedConnection(orgId: string, actorId: string): Promise<void> {
  await db.insert(schema.integration).values({
    organizationId: orgId,
    createdBy: actorId,
    provider: 'drive',
    pattern: 'connector',
    roles: ['context'],
    status: 'connected',
    connection: {},
  });
}

/** A gateway that answers every `openResourceSearch` call the same way, in call order. */
function gatewayOf(
  first: ConnectorAccessResult,
  ...rest: ConnectorAccessResult[]
): ConnectorGateway {
  const answers = [first, ...rest];
  let index = 0;
  return {
    openResourceSearch: () => {
      const answer = answers[Math.min(index, answers.length - 1)] ?? first;
      index += 1;
      return Promise.resolve(answer);
    },
  };
}

const resource = (over: Partial<ExternalResource> = {}): ExternalResource => ({
  provider: 'google_drive',
  externalId: 'ext_1',
  resourceType: 'file',
  title: 'Q3 plan',
  url: 'https://example.com/1',
  ...over,
});

/** A search handle that returns the given resources, or throws when asked. */
function searchOf(
  behavior: { readonly resources: readonly ExternalResource[] } | { readonly throws: unknown },
): ResourceSearch {
  return {
    searchResources() {
      if ('throws' in behavior) {
        // The whole point of this case is a value that is NOT an Error, to prove
        // `statusForError`'s fallback branch — the lint rule's assumption doesn't hold here.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(behavior.throws);
      }
      return Promise.resolve({ resources: [...behavior.resources], truncated: false });
    },
    resolveResource: () => Promise.resolve(undefined),
  };
}

describe('searchExternalMentions: failure classification', () => {
  it('reports an expired grant as reauth required', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({ ok: false, reason: 'needs_reauth' });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'reauth_required' })]);
    expect(result.items).toEqual([]);
  });

  it('reports a connection with no live token as not connected', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({ ok: false, reason: 'not_connected' });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'not_connected' })]);
  });

  it('classifies a rate-limited search as throttled, distinct from an auth failure', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({
      ok: true,
      search: searchOf({
        throws: new ConnectorError('rate limited', { provider: 'gtasks', kind: 'rate_limit' }),
      }),
    });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'throttled' })]);
  });

  it('classifies an auth failure mid-search the same as a failure to open one', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({
      ok: true,
      search: searchOf({
        throws: new ConnectorError('revoked', { provider: 'gtasks', kind: 'auth' }),
      }),
    });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'reauth_required' })]);
  });

  it('classifies a search that ran out the deadline as timed out', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    const gateway = gatewayOf({ ok: true, search: searchOf({ throws: timeout }) });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'timed_out' })]);
  });

  it('falls back to unavailable for a provider error that names no specific kind', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({
      ok: true,
      search: searchOf({
        throws: new ConnectorError('broke', { provider: 'gtasks', kind: 'provider' }),
      }),
    });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'unavailable' })]);
  });

  it('falls back to unavailable for a thrown value that is not a recognized error shape', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf({ ok: true, search: searchOf({ throws: 'a bare string' }) });

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.providers).toEqual([expect.objectContaining({ status: 'unavailable' })]);
  });
});

describe('searchExternalMentions: result shaping', () => {
  it('drops a resource two sources both returned, keeping the first', async () => {
    // A shared drive visible to two different connections should not double a row in the menu.
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    await seedConnection(orgId, humanActorId);
    const gateway = gatewayOf(
      {
        ok: true,
        search: searchOf({ resources: [resource({ externalId: 'dup', title: 'First' })] }),
      },
      {
        ok: true,
        search: searchOf({ resources: [resource({ externalId: 'dup', title: 'Second' })] }),
      },
    );

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('First');
  });

  it('does not fail the whole request when one gateway call rejects', async () => {
    // `openResourceSearch` itself throwing (not the search call) still must not empty the menu.
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId);
    const gateway: ConnectorGateway = {
      openResourceSearch: () => Promise.reject(new Error('gateway exploded')),
    };

    const result = await searchExternalMentions({
      orgId,
      actorId: humanActorId,
      query: 'plan',
      limit: 10,
      gateway,
    });
    expect(result).toEqual({ items: [], providers: [] });
  });
});
