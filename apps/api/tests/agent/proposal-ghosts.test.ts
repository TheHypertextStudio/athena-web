import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ProposalGroupOut } from '@docket/athena/agent-contract';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../src/error';
import type {
  editProposalInput as EditProposalInput,
  listProposalGroups as ListProposalGroups,
  proposalInputOrganizationId as ProposalInputOrganizationId,
  proposalOrganizationId as ProposalOrganizationId,
} from '../../src/agent/proposals';
import type { ActivityRow } from '../../src/routes/agent-session-helpers';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let listProposalGroups!: typeof ListProposalGroups;
let editProposalInput!: typeof EditProposalInput;
let proposalOrganizationId!: typeof ProposalOrganizationId;
let proposalInputOrganizationId!: typeof ProposalInputOrganizationId;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  const mod = await import('../../src/agent/proposals');
  listProposalGroups = mod.listProposalGroups;
  editProposalInput = mod.editProposalInput;
  proposalOrganizationId = mod.proposalOrganizationId;
  proposalInputOrganizationId = mod.proposalInputOrganizationId;
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
  const orgId = assertDefined(org).id;

  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const [agent] = await db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: assertDefined(actor).id })
    .returning({ id: schema.agent.id });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: assertDefined(agent).id,
      trigger: 'delegation',
      status: 'awaiting_approval',
    })
    .returning({ id: schema.agentSession.id });

  return { orgId, sessionId: assertDefined(session).id };
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
  return assertDefined(groups[0]);
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

  it('drops an organize item whose single entry is not an object, or is null', async () => {
    const seed = await seedSession();
    const numberItem = await propose(seed, 'organize', { orgId: seed.orgId, items: [42] });
    expect(ghostOf(numberItem)).toBeNull();
    const nullItem = await propose(seed, 'organize', { orgId: seed.orgId, items: [null] });
    expect(ghostOf(nullItem)).toBeNull();
  });

  it('drops an organize task item with no title', async () => {
    const seed = await seedSession();
    const group = await propose(seed, 'organize', {
      orgId: seed.orgId,
      items: [{ ref: 't', kind: 'task' }],
    });
    expect(ghostOf(group)).toBeNull();
  });

  it('skips a proposed activity row whose body carries no action at all', async () => {
    const seed = await seedSession();
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'grp-malformed',
      body: {},
    });
    // The row exists, but projects to nothing reviewable — never a group with no items.
    expect(await listProposalGroups(seed.sessionId)).toEqual([]);
  });

  it('falls back to an empty input when a stored tool call carries no object input', async () => {
    const seed = await seedSession();
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'grp-null-input',
      body: {
        action: {
          kind: 'custom',
          summary: 'Proposed capture',
          toolCall: { connection: 'docket', tool: 'capture', input: null, toolUseId: 'toolu_2' },
        },
      },
    });
    const [group] = await listProposalGroups(seed.sessionId);
    expect(group?.items[0]?.input).toEqual({});
    expect(ghostOf(assertDefined(group))).toBeNull();
  });
});

describe('proposalInputOrganizationId', () => {
  it('reads a non-empty string orgId and rejects everything else', () => {
    expect(proposalInputOrganizationId({ orgId: 'org_1' })).toBe('org_1');
    expect(proposalInputOrganizationId(null)).toBeNull();
    expect(proposalInputOrganizationId(undefined)).toBeNull();
    expect(proposalInputOrganizationId([])).toBeNull();
    expect(proposalInputOrganizationId('a string')).toBeNull();
    expect(proposalInputOrganizationId({})).toBeNull();
    expect(proposalInputOrganizationId({ orgId: 42 })).toBeNull();
    expect(proposalInputOrganizationId({ orgId: '' })).toBeNull();
  });
});

/** Build a minimal in-memory activity row, for the pure `proposalOrganizationId` unit tests. */
function fakeActivityRow(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 'act_1',
    sessionId: 'sess_1',
    organizationId: null,
    type: 'action',
    approvalStatus: 'proposed',
    proposalGroupId: 'grp_1',
    body: {},
    createdAt: new Date(),
    ...overrides,
  } as ActivityRow;
}

describe('proposalOrganizationId', () => {
  it("uses the row's own organizationId when there is no stored tool call", () => {
    const row = fakeActivityRow({ organizationId: 'org_row', body: {} });
    expect(proposalOrganizationId(row, 'org_fallback')).toBe('org_row');
  });

  it('falls back to the caller-supplied workspace when the row has none and there is no call', () => {
    const row = fakeActivityRow({ organizationId: null, body: {} });
    expect(proposalOrganizationId(row, 'org_fallback')).toBe('org_fallback');
  });

  it('refuses to guess a workspace when neither the row nor the fallback declares one', () => {
    const row = fakeActivityRow({ organizationId: null, body: {} });
    expect(() => proposalOrganizationId(row, '')).toThrow(ConflictError);
    expect(() => proposalOrganizationId(row, '')).toThrow(/does not declare a workspace/);
  });

  it("reads the workspace off the stored tool call's input when one is recorded", () => {
    const row = fakeActivityRow({
      organizationId: null,
      body: {
        action: {
          kind: 'custom',
          summary: 'Proposed capture',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            input: { orgId: 'org_from_call' },
            toolUseId: 'toolu_1',
          },
        },
      },
    });
    expect(proposalOrganizationId(row, 'org_fallback')).toBe('org_from_call');
  });

  it('refuses a stored tool call whose input names no workspace', () => {
    const row = fakeActivityRow({
      organizationId: 'org_row',
      body: {
        action: {
          kind: 'custom',
          summary: 'Proposed capture',
          toolCall: { connection: 'docket', tool: 'capture', input: {}, toolUseId: 'toolu_1' },
        },
      },
    });
    expect(() => proposalOrganizationId(row, 'org_fallback')).toThrow(ConflictError);
  });
});

describe('editProposalInput', () => {
  it('rejects an activity id that does not exist in the session', async () => {
    const seed = await seedSession();
    await expect(
      editProposalInput(seed.sessionId, 'act_does_not_exist', { text: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects editing an activity that is not an editable pending proposal', async () => {
    const seed = await seedSession();
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'response',
        approvalStatus: 'proposed',
        body: { text: 'hello', author: 'athena' },
      })
      .returning({ id: schema.sessionActivity.id });
    await expect(
      editProposalInput(seed.sessionId, assertDefined(row).id, { text: 'edited' }),
    ).rejects.toThrow(/editable pending proposal/);
  });

  it('edits a proposal with no authorization constraint, keeping its stored workspace', async () => {
    const seed = await seedSession();
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-1',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e1',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const updated = await editProposalInput(seed.sessionId, assertDefined(row).id, {
      orgId: seed.orgId,
      text: 'revised draft',
    });
    expect(updated.organizationId).toBe(seed.orgId);
    expect(updated.body.action?.toolCall?.input).toMatchObject({ text: 'revised draft' });
  });

  it('requires a workspace-declaring input for an Athena owner edit', async () => {
    const seed = await seedSession();
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-2',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e2',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    await expect(
      editProposalInput(
        seed.sessionId,
        assertDefined(row).id,
        { text: 'no workspace named' },
        { athenaOwnerUserId: 'user_1' },
      ),
    ).rejects.toThrow(/does not declare a workspace/);
  });

  it("rejects an Athena owner edit that targets a workspace they don't belong to", async () => {
    const seed = await seedSession();
    const otherOrgId = assertDefined(
      (
        await db
          .insert(schema.organization)
          .values({
            name: `other-${Math.random().toString(36).slice(2, 8)}`,
            slug: `other-${Math.random().toString(36).slice(2, 8)}`,
            lifecycleState: 'active',
          })
          .returning({ id: schema.organization.id })
      )[0],
    ).id;
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-3',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e3',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    await expect(
      editProposalInput(
        seed.sessionId,
        assertDefined(row).id,
        { orgId: otherOrgId, text: 'redirected' },
        { athenaOwnerUserId: 'user_without_membership' },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('lets an Athena owner move a proposal to a workspace they belong to', async () => {
    const seed = await seedSession();
    const destinationOrgId = assertDefined(
      (
        await db
          .insert(schema.organization)
          .values({
            name: `dest-${Math.random().toString(36).slice(2, 8)}`,
            slug: `dest-${Math.random().toString(36).slice(2, 8)}`,
            lifecycleState: 'active',
          })
          .returning({ id: schema.organization.id })
      )[0],
    ).id;
    const userId = assertDefined(
      (
        await db
          .insert(schema.user)
          .values({
            name: 'Owner',
            email: `owner-${Math.random().toString(36).slice(2, 8)}@x.test`,
          })
          .returning({ id: schema.user.id })
      )[0],
    ).id;
    await db.insert(schema.actor).values({
      organizationId: destinationOrgId,
      userId,
      kind: 'human',
      displayName: 'Owner',
      status: 'active',
    });
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-4',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e4',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const updated = await editProposalInput(
      seed.sessionId,
      assertDefined(row).id,
      { orgId: destinationOrgId, text: 'moved' },
      { athenaOwnerUserId: userId },
    );
    expect(updated.organizationId).toBe(destinationOrgId);
  });

  it('rejects a registered-agent edit that redirects a proposal to a foreign workspace', async () => {
    const seed = await seedSession();
    const foreignOrgId = assertDefined(
      (
        await db
          .insert(schema.organization)
          .values({
            name: `foreign-${Math.random().toString(36).slice(2, 8)}`,
            slug: `foreign-${Math.random().toString(36).slice(2, 8)}`,
            lifecycleState: 'active',
          })
          .returning({ id: schema.organization.id })
      )[0],
    ).id;
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-5',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e5',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    await expect(
      editProposalInput(
        seed.sessionId,
        assertDefined(row).id,
        { orgId: foreignOrgId, text: 'redirected' },
        { registeredOrganizationId: seed.orgId },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('allows a registered-agent edit that keeps the proposal in its own workspace', async () => {
    const seed = await seedSession();
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: 'grp-edit-6',
        body: {
          action: {
            kind: 'custom',
            summary: 'Proposed capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'first draft' },
              toolUseId: 'toolu_e6',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const updated = await editProposalInput(
      seed.sessionId,
      assertDefined(row).id,
      { orgId: seed.orgId, text: 'still here' },
      { registeredOrganizationId: seed.orgId },
    );
    expect(updated.organizationId).toBe(seed.orgId);
    expect(updated.body.action?.toolCall?.input).toMatchObject({ text: 'still here' });
  });
});
