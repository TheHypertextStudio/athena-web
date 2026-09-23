/**
 * `@docket/api` — the origin block on a hydrated task resource reads normalized provenance.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as HydratorsModule from '../../src/mcp/resource-work-hydrators';
import type * as ProvenanceContext from '../../src/lib/provenance/context';
import { getDb } from '../support/routes-harness';

let hydrators!: typeof HydratorsModule;
let context!: typeof ProvenanceContext;

beforeAll(async () => {
  await getDb();
  hydrators = await import('../../src/mcp/resource-work-hydrators');
  context = await import('../../src/lib/provenance/context');
});

const at = new Date('2026-09-01T12:00:00.000Z');

describe('hydratedOrigin', () => {
  it('is null when no recorded change created the task', () => {
    expect(hydrators.hydratedOrigin(null)).toBeNull();
  });

  it('exposes the channel, performer, and session of a recorded creation', () => {
    const origin = context.originFor(
      'capture',
      { sessionId: 'athena_session' },
      context.athenaProvenance('chat'),
    );

    expect(hydrators.hydratedOrigin({ origin, at, actorId: 'actor_owner' })).toEqual({
      channel: 'athena',
      surface: 'chat',
      performerKind: 'athena',
      performerName: 'Athena',
      clientName: null,
      provider: null,
      sessionId: 'athena_session',
      planId: null,
      actorId: 'actor_owner',
      at: at.toISOString(),
    });
  });

  it('normalizes a first-version origin and drops one it cannot place', () => {
    expect(
      hydrators.hydratedOrigin({
        origin: { tool: 'capture', client: 'Cursor' },
        at,
        actorId: 'actor_owner',
      }),
    ).toMatchObject({ channel: 'mcp', performerKind: 'agent', clientName: 'Cursor' });
    expect(
      hydrators.hydratedOrigin({ origin: { tool: 'update' }, at, actorId: 'actor_owner' }),
    ).toBeNull();
  });
});
