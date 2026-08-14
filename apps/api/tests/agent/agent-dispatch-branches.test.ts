/**
 * `agent-dispatch` branch-coverage top-up.
 *
 * @remarks
 * `tests/agent/athena-dispatcher.test.ts` already covers the dispatcher's headline behaviors
 * (one conversation, task linkage, interrupt propagation). This file closes the narrower branches
 * that suite never touches: the freeform-title edge cases, a workspace with no team to land work
 * in, filing work under a `program` or `milestone` parent (not just `project`), and the empty
 * input to `countWritesAfter`.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type {
  countWritesAfter as CountWritesAfter,
  dispatchAthenaWork as DispatchAthenaWork,
  recordCurrentStep as RecordCurrentStep,
} from '../../src/routes/agent-dispatch';
import { getDb, seedBaseOrg, seedOrg, seedUserWithHub } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let dispatchAthenaWork!: typeof DispatchAthenaWork;
let countWritesAfter!: typeof CountWritesAfter;
let recordCurrentStep!: typeof RecordCurrentStep;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ dispatchAthenaWork, countWritesAfter, recordCurrentStep } =
    await import('../../src/routes/agent-dispatch'));
});

describe('deriveTaskTitle (via dispatchAthenaWork)', () => {
  it('titles a blank/whitespace-only prompt "Untitled work"', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'BlankPrompt');
    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: '   ',
      organizationId: null,
      initiatorActorId: null,
    });
    expect(dispatched.session.spawnLabel).toBe('Untitled work');
  });

  it('truncates a long first line to 120 characters with an ellipsis', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'LongPrompt');
    const longLine = 'a'.repeat(150);
    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: longLine,
      organizationId: null,
      initiatorActorId: null,
    });
    expect(dispatched.session.spawnLabel).toBe(`${'a'.repeat(119)}…`);
    expect(dispatched.session.spawnLabel?.length).toBe(120);
  });

  it('keeps a short first line of a multi-line prompt verbatim', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'MultilinePrompt');
    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Draft the memo\n\nWith supporting detail below.',
      organizationId: null,
      initiatorActorId: null,
    });
    expect(dispatched.session.spawnLabel).toBe('Draft the memo');
  });
});

describe('dispatchAthenaWork with no team to land in', () => {
  it('starts unlinked and says so when the workspace has no team at all', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'NoTeamOwner');
    const orgId = await seedOrg(db, schema);
    const [actor] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
      .returning({ id: schema.actor.id });
    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Plan the thing',
      organizationId: orgId,
      initiatorActorId: assertDefined(actor).id,
    });
    expect(dispatched.taskId).toBeNull();
    expect(dispatched.parent).toBeNull();
    expect(dispatched.linkageNote).toBe(
      'Started without a tracked task — this workspace has no team to file work into yet.',
    );
    expect(dispatched.session.workLinkage).toBe('unclassified');
  });
});

describe('parentColumns files work under every referenceable container kind', () => {
  it('files a matching request under a program, not just a project', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const ownerUserId = await seedUserWithHub(db, schema, 'ProgramOwner');
    const [program] = await db
      .insert(schema.program)
      .values({
        organizationId: orgId,
        name: 'Zephyrfest Roadmap',
        description: 'The whole Zephyrfest program of work.',
      })
      .returning({ id: schema.program.id });

    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Get ready for the Zephyrfest roadmap review',
      organizationId: orgId,
      initiatorActorId: assertDefined(
        (
          await db
            .select({ id: schema.actor.id })
            .from(schema.actor)
            .where(eq(schema.actor.organizationId, orgId))
            .limit(1)
        )[0],
      ).id,
    });

    expect(dispatched.parent?.parent?.kind).toBe('program');
    expect(dispatched.parent?.parent?.id).toBe(assertDefined(program).id);
    const rows = await db
      .select({ programId: schema.task.programId, projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(dispatched.taskId)));
    expect(rows[0]?.programId).toBe(assertDefined(program).id);
    expect(rows[0]?.projectId).toBeNull();
    // A team must still exist for the task to land somewhere assignable.
    expect(teamId).toEqual(expect.any(String));
  });

  it('files a matching request under a milestone, not just a project', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const ownerUserId = await seedUserWithHub(db, schema, 'MilestoneOwner');
    // A milestone must belong to a project; give it a generic name so it never outscores the
    // milestone itself for this prompt.
    const [project] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'General Work', description: 'Everything else.' })
      .returning({ id: schema.project.id });
    const [milestone] = await db
      .insert(schema.milestone)
      .values({
        organizationId: orgId,
        projectId: assertDefined(project).id,
        name: 'Zephyrfest Launch Party',
      })
      .returning({ id: schema.milestone.id });

    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Finish planning the Zephyrfest launch party',
      organizationId: orgId,
      initiatorActorId: assertDefined(
        (
          await db
            .select({ id: schema.actor.id })
            .from(schema.actor)
            .where(eq(schema.actor.organizationId, orgId))
            .limit(1)
        )[0],
      ).id,
    });

    expect(dispatched.parent?.parent?.kind).toBe('milestone');
    expect(dispatched.parent?.parent?.id).toBe(assertDefined(milestone).id);
    const rows = await db
      .select({ milestoneId: schema.task.milestoneId, projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(dispatched.taskId)));
    expect(rows[0]?.milestoneId).toBe(assertDefined(milestone).id);
    expect(rows[0]?.projectId).toBeNull();
  });
});

describe('countWritesAfter with no sessions to check', () => {
  it('reports zero writes for an empty session list without querying', async () => {
    expect(await countWritesAfter([], new Date())).toBe(0);
  });
});

describe('recordCurrentStep', () => {
  it('persists the step with and without a self-reported progress figure', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'RecordStepOwner');
    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Track my own progress',
      organizationId: null,
      initiatorActorId: null,
    });
    const sessionId = dispatched.session.id;

    await recordCurrentStep(sessionId, ownerUserId, 'Reading the brief', 42);
    let rows = await db
      .select({ currentStep: schema.agentSession.currentStep })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(rows[0]?.currentStep).toBe('Reading the brief');

    await recordCurrentStep(sessionId, ownerUserId, 'Writing the summary');
    rows = await db
      .select({ currentStep: schema.agentSession.currentStep })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(rows[0]?.currentStep).toBe('Writing the summary');
  });
});
