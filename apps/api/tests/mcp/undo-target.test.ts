import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import {
  appProvenance,
  clientProvenance,
  originFor,
  type ProvenanceBase,
  runWithProvenance,
} from '../../src/lib/provenance/context';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const CLAUDE: ProvenanceBase = {
  ...clientProvenance('mcp', { name: 'Claude', id: 'client_claude' }),
  sessionId: 'mcp_one',
};

/** Record an empty change set for the actor under `base`, and return its id. */
async function record(orgId: string, actorId: string, base: ProvenanceBase): Promise<string> {
  const { recordChangeSetInTx } = await import('../../src/mcp/change-set');
  const id = await db.transaction((tx) =>
    recordChangeSetInTx(tx, {
      orgId,
      actorId,
      origin: originFor('probe', {}, base),
      summary: 'probe',
      changes: [],
      recordEmpty: true,
    }),
  );
  if (!id) throw new Error('The probe change set was not recorded.');
  return id;
}

describe('latestOwnChangeSet', () => {
  it('reaches for the caller’s own last change, not a later edit made in the app', async () => {
    const { latestOwnChangeSet } = await import('../../src/mcp/undo-target');
    const seeded = await seedBaseOrg(db, schema);
    const own = await record(seeded.orgId, seeded.humanActorId, CLAUDE);
    await record(seeded.orgId, seeded.humanActorId, appProvenance('detail'));

    const target = await runWithProvenance(CLAUDE, () =>
      latestOwnChangeSet(seeded.orgId, seeded.humanActorId),
    );

    expect(target).toBe(own);
  });

  it('leaves another client’s and another session’s changes alone', async () => {
    const { latestOwnChangeSet } = await import('../../src/mcp/undo-target');
    const seeded = await seedBaseOrg(db, schema);
    await record(seeded.orgId, seeded.humanActorId, {
      ...clientProvenance('mcp', { name: 'Cursor', id: 'client_cursor' }),
      sessionId: 'mcp_one',
    });
    await record(seeded.orgId, seeded.humanActorId, { ...CLAUDE, sessionId: 'mcp_two' });

    const target = await runWithProvenance(CLAUDE, () =>
      latestOwnChangeSet(seeded.orgId, seeded.humanActorId),
    );

    expect(target).toBeUndefined();
  });

  it('still reaches a change recorded before provenance', async () => {
    const { latestOwnChangeSet } = await import('../../src/mcp/undo-target');
    const seeded = await seedBaseOrg(db, schema);
    const legacy = await record(seeded.orgId, seeded.humanActorId, CLAUDE);
    await db
      .update(schema.changeSet)
      .set({ origin: { tool: 'capture', sessionId: 'mcp_one' } })
      .where(eq(schema.changeSet.id, legacy));

    const target = await runWithProvenance(CLAUDE, () =>
      latestOwnChangeSet(seeded.orgId, seeded.humanActorId),
    );

    expect(target).toBe(legacy);
  });
});
