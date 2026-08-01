import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ProposalGroupOut } from '@docket/types';
import type { z } from 'zod';

import type { listProposalGroups as ListProposalGroups } from '../../src/agent/proposals';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let listProposalGroups!: typeof ListProposalGroups;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  listProposalGroups = (await import('../../src/agent/proposals')).listProposalGroups;
});

interface Seed {
  orgId: string;
  sessionId: string;
}

/** Seed an org with one agent session to hang proposals off. */
async function seedSession(): Promise<Seed> {
  const slug = `gh-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const [agent] = await db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: actor!.id })
    .returning({ id: schema.agent.id });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: agent!.id,
      trigger: 'delegation',
      status: 'awaiting_approval',
    })
    .returning({ id: schema.agentSession.id });

  return { orgId, sessionId: session!.id };
}

/** Record one proposed tool call and return the group it was projected into. */
async function propose(
  seed: Seed,
  tool: string,
  input: Record<string, unknown>,
): Promise<z.input<typeof ProposalGroupOut>> {
  await db.insert(schema.sessionActivity).values({
    sessionId: seed.sessionId,
    organizationId: seed.orgId,
    type: 'action',
    approvalStatus: 'proposed',
    proposalGroupId: `grp-${Math.random().toString(36).slice(2, 8)}`,
    body: {
      action: {
        kind: 'custom',
        summary: `Proposed ${tool}`,
        toolCall: { connection: 'docket', tool, input, toolUseId: 'toolu_1' },
      },
    },
  });
  const groups = await listProposalGroups(seed.sessionId);
  return groups[0]!;
}

/** The projected ghost of the group's only item. */
function ghostOf(group: z.input<typeof ProposalGroupOut>): Record<string, unknown> | null {
  const item = group.items[0] as { ghost?: Record<string, unknown> | null };
  return item.ghost ?? null;
}

describe('proposal ghosts', () => {
  it('projects a capture as an editable task row', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'capture', {
      orgId: seed.orgId,
      text: 'Chase the vendor SOC2\nthey went quiet last week',
    });
    // The title matches what `capture` itself would derive, so the preview and the write agree.
    expect(ghostOf(group)).toEqual({
      title: 'Chase the vendor SOC2',
      teamId: null,
      projectId: null,
      dueDate: null,
    });
  });

  it('projects a single-task organize, carrying the fields it named', async () => {
    const seed = await seedSession();
    const projectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const group = await propose(seed, 'organize', {
      orgId: seed.orgId,
      items: [
        {
          ref: 't',
          kind: 'task',
          title: 'Write the migration',
          project: projectId,
          dueDate: '2026-08-01',
        },
      ],
    });
    expect(ghostOf(group)).toEqual({
      title: 'Write the migration',
      teamId: null,
      projectId,
      dueDate: '2026-08-01',
    });
  });

  it('drops a project named rather than identified, since a ghost renders by id', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'organize', {
      orgId: seed.orgId,
      items: [{ ref: 't', kind: 'task', title: 'Named ref', project: 'Platform Migration' }],
    });
    // The name still reaches the reviewer in `input`; the ghost shows the field unset rather
    // than pointing the workspace at something it cannot look up.
    expect(ghostOf(group)).toMatchObject({ title: 'Named ref', projectId: null });
    expect(group.items[0]?.input).toMatchObject({
      items: [expect.objectContaining({ project: 'Platform Migration' })],
    });
  });

  it('gives a multi-node plan no ghost, so it reviews in the session card', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'organize', {
      orgId: seed.orgId,
      items: [
        { ref: 'p', kind: 'project', title: 'Auth Rewrite' },
        { ref: 't', kind: 'task', title: 'Audit the session store', parent: 'p' },
      ],
    });
    // A tree has no single spatial home; faking one by picking the first item would preview a
    // change the approval does not make.
    expect(ghostOf(group)).toBeNull();
  });

  it('gives a container no task ghost', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'organize', {
      orgId: seed.orgId,
      items: [{ ref: 'i', kind: 'initiative', title: 'Q3 Platform' }],
    });
    expect(ghostOf(group)).toBeNull();
  });

  it('gives a scope-shaped update no ghost', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'update', {
      orgId: seed.orgId,
      entity: 'task',
      scope: { assignee: 'Sarah' },
      set: { assignee: 'Ada' },
    });
    // An update names a set by predicate, not a row — there is nowhere to render it in place.
    expect(ghostOf(group)).toBeNull();
  });

  it('gives an empty capture no ghost rather than a blank row', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'capture', { orgId: seed.orgId, text: '   ' });
    expect(ghostOf(group)).toBeNull();
  });

  it('keeps the raw tool name on the item, whatever the ghost does', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'capture', { orgId: seed.orgId, text: 'Trace me' });
    expect(group.items[0]?.tool).toBe('capture');

    const rows = await db
      .select({ type: schema.sessionActivity.type })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, seed.sessionId));
    expect(rows).toHaveLength(1);
  });
});
