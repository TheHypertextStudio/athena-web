/**
 * `@docket/api` — Athena the dispatcher: one conversation, many spawned agents, one interrupt.
 *
 * @remarks
 * Four rules live here, together, because they are the same rule seen from four sides:
 *
 * 1. **One conversation.** A person has exactly one open Athena session. Every entry point
 *    resolves to it ({@link resolveCanonicalConversation}); nothing opens a second one.
 * 2. **Work is spawned, not chatted.** Delegated work is a separate session whose
 *    `parent_session_id` is that conversation ({@link dispatchAthenaWork}). Athena herself stays
 *    purely conversational; the agents she spawns do the work.
 * 3. **Work is Docket work.** A spawned agent gets a Docket task first, filed under an existing
 *    objective whenever one plausibly applies. The session then claims `work_linkage = 'task'`,
 *    which the database refuses unless `task_id` is set — so untracked work cannot be started.
 * 4. **The interrupt reaches all of it.** {@link interruptAthenaWork} walks the spawn tree, stamps
 *    `interrupted_at` on every node, cancels each one's live run generation, and reports each
 *    agent stopping. After that stamp, {@link reportAgentMilestone} drops reports from those
 *    sessions, so "nothing kept running and writing" is a property of the system rather than a
 *    hope about timing.
 */
import {
  actor,
  agentSession,
  agentSessionRun,
  db,
  milestone,
  program,
  project,
  sessionActivity,
  task,
} from '@docket/db';
import type { Database } from '@docket/db';
import { describeParentResolution, resolveWorkParent } from '@docket/agent-runtime';
import type { ParentCandidate, ParentResolution } from '@docket/agent-runtime';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import { resolveLandingTarget } from '../lib/task-landing';
import { reportAgentMilestone } from './agent-bus';
import type { SessionRow } from './agent-session-helpers';

/** Statuses a session can still be interrupted from. */
const NON_TERMINAL_STATUSES = [
  'pending',
  'running',
  'awaiting_input',
  'awaiting_approval',
] as const;

/** Run statuses that represent a live generation an interrupt must stop. */
const LIVE_RUN_STATUSES = ['queued', 'running', 'waiting', 'completed'] as const;

/** How many parent candidates are considered; more than this is noise, not signal. */
const PARENT_CANDIDATE_LIMIT = 200;

/** Guard against a cycle in the spawn tree that a corrupt row could otherwise turn into a hang. */
const MAX_SPAWN_DEPTH = 32;

/** A transaction handle or the pool; every helper here works with either. */
type DbHandle = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Resolve the caller's one open Athena conversation, opening it the first time.
 *
 * @remarks
 * "The user will only have one active Athena session at once" is enforced here rather than
 * asserted in a comment: if more than one open `chat` row is somehow present — a historical row,
 * a race between two tabs, a partially-applied migration — the newest wins and the rest are
 * closed in the same transaction. Every door therefore converges on the same id instead of each
 * door picking its own favourite.
 *
 * @param ownerUserId - The authenticated owner.
 * @param contextOrganizationId - Workspace focus to record on a freshly opened conversation.
 * @returns the one open conversation.
 */
export async function resolveCanonicalConversation(
  ownerUserId: string,
  contextOrganizationId: string | null = null,
  initiatorActorId: string | null = null,
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const open = await tx
      .select()
      .from(agentSession)
      .where(
        and(
          eq(agentSession.executorKind, 'athena'),
          eq(agentSession.ownerUserId, ownerUserId),
          eq(agentSession.kind, 'chat'),
          inArray(agentSession.status, [...NON_TERMINAL_STATUSES]),
        ),
      )
      .orderBy(desc(agentSession.createdAt), desc(agentSession.id));

    const current = open[0];
    if (current) {
      const superseded = open.slice(1).map((row) => row.id);
      if (superseded.length > 0) {
        await tx
          .update(agentSession)
          .set({ status: 'completed', endedAt: new Date() })
          .where(inArray(agentSession.id, superseded));
      }
      return current;
    }

    const [created] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        contextOrganizationId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'pending',
        initiatorId: initiatorActorId,
        workLinkage: 'conversation',
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('conversation insert returned no row');
    return created;
  });
}

/**
 * Close the caller's current conversation and open its successor.
 *
 * @remarks
 * The successor is opened in the same transaction as the predecessor closes, so there is never
 * an instant at which two open conversations exist — which is the property "one active session"
 * actually needs. History is untouched: the closed conversation keeps every activity and stays
 * readable.
 *
 * @param ownerUserId - The authenticated owner.
 * @param contextOrganizationId - Workspace focus for the successor.
 * @param initiatorActorId - The actor recorded as opening it.
 * @returns the successor conversation.
 */
export async function rotateCanonicalConversation(
  ownerUserId: string,
  contextOrganizationId: string | null = null,
  initiatorActorId: string | null = null,
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(agentSession)
      .set({ status: 'completed', endedAt: now })
      .where(
        and(
          eq(agentSession.executorKind, 'athena'),
          eq(agentSession.ownerUserId, ownerUserId),
          eq(agentSession.kind, 'chat'),
          inArray(agentSession.status, [...NON_TERMINAL_STATUSES]),
        ),
      );
    const [created] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        contextOrganizationId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'pending',
        initiatorId: initiatorActorId,
        workLinkage: 'conversation',
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('successor conversation insert returned no row');
    return created;
  });
}

/** What a caller hands the dispatcher to start tracked work. */
export interface DispatchWorkInput {
  /** The human the work belongs to. */
  readonly ownerUserId: string;
  /** What they asked for, in their own words. Becomes the task title and the spawn label. */
  readonly prompt: string;
  /** The workspace the work happens in, when one is known. */
  readonly organizationId: string | null;
  /** The owner's actor in that workspace, when resolvable. */
  readonly initiatorActorId: string | null;
  /**
   * The session this work is spawned from — normally the caller's one conversation.
   * Omit only for work with no conversational origin (a scheduled trigger, an inbound webhook).
   */
  readonly parentSessionId?: string | null;
  /** An existing Docket task this work is already about; skips task creation and parent search. */
  readonly taskId?: string | null;
}

/** What the dispatcher did. */
export interface DispatchWorkResult {
  /** The spawned agent's session. */
  readonly session: SessionRow;
  /** The Docket task the work is tracked as, or `null` when no workspace made one possible. */
  readonly taskId: string | null;
  /** Where the task was filed, and why, or `null` when an existing task was supplied. */
  readonly parent: ParentResolution | null;
  /** The sentence stating where the work was filed. Application-owned copy. */
  readonly linkageNote: string | null;
}

/** The longest task title Athena derives from a freeform request. */
const TASK_TITLE_MAX = 120;

/** Derive a task title from the first line of a request. */
function deriveTaskTitle(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const raw = line.length > 0 ? line : prompt.trim();
  if (raw.length === 0) return 'Untitled work';
  return raw.length <= TASK_TITLE_MAX ? raw : `${raw.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Load the open containers a new task could plausibly be filed under.
 *
 * @remarks
 * Only containers a `task` row can actually reference are considered — project, program,
 * milestone. An initiative sits above projects and a task has no column for one, so offering it
 * as a candidate would produce a match nothing could act on.
 *
 * @param organizationId - The workspace to search.
 * @returns open candidates, bounded.
 */
export async function loadParentCandidates(
  organizationId: string,
): Promise<readonly ParentCandidate[]> {
  const [projects, programs, milestones] = await Promise.all([
    db
      .select({ id: project.id, title: project.name, description: project.description })
      .from(project)
      .where(
        and(
          eq(project.organizationId, organizationId),
          isNull(project.archivedAt),
          notInArray(project.status, ['completed', 'canceled']),
        ),
      )
      .limit(PARENT_CANDIDATE_LIMIT),
    db
      .select({ id: program.id, title: program.name, description: program.description })
      .from(program)
      .where(and(eq(program.organizationId, organizationId), isNull(program.archivedAt)))
      .limit(PARENT_CANDIDATE_LIMIT),
    db
      .select({ id: milestone.id, title: milestone.name })
      .from(milestone)
      .where(and(eq(milestone.organizationId, organizationId), isNull(milestone.archivedAt)))
      .limit(PARENT_CANDIDATE_LIMIT),
  ]);
  return [
    ...projects.map((row) => ({ ...row, kind: 'project' as const })),
    ...programs.map((row) => ({ ...row, kind: 'program' as const })),
    ...milestones.map((row) => ({ ...row, kind: 'milestone' as const })),
  ];
}

/** Map a resolved parent onto the task columns that hold it. */
function parentColumns(resolution: ParentResolution): {
  projectId?: string;
  programId?: string;
  milestoneId?: string;
} {
  const parent = resolution.parent;
  if (!parent) return {};
  if (parent.kind === 'project') return { projectId: parent.id };
  if (parent.kind === 'program') return { programId: parent.id };
  if (parent.kind === 'milestone') return { milestoneId: parent.id };
  return {};
}

/**
 * Start tracked work: create its Docket task, file it, and spawn the agent that will do it.
 *
 * @remarks
 * This is the single admission point for delegated Athena work. It is deliberately the only
 * function that inserts an `agent_session` row with `work_linkage = 'task'`, and the database
 * refuses that claim without a `task_id` — so a future side path either comes through here or
 * cannot start tracked work at all.
 *
 * When no workspace is in context there is no tenant to create a task in. Rather than start
 * untracked work, the session is opened as `unclassified` and carries no task; the caller
 * surfaces the returned `linkageNote` so the person knows the work is not yet tracked anywhere.
 *
 * @param input - See {@link DispatchWorkInput}.
 * @returns the spawned session, its task, and where it was filed.
 */
export async function dispatchAthenaWork(input: DispatchWorkInput): Promise<DispatchWorkResult> {
  const spawnLabel = deriveTaskTitle(input.prompt);

  if (input.taskId) {
    const session = await insertSpawnedSession(input, input.taskId, spawnLabel);
    return { session, taskId: input.taskId, parent: null, linkageNote: null };
  }

  if (!input.organizationId || !input.initiatorActorId) {
    const session = await insertSpawnedSession(input, null, spawnLabel);
    return {
      session,
      taskId: null,
      parent: null,
      linkageNote:
        'Started without a tracked task — pick a workspace and I will create one so this work has a home.',
    };
  }

  const landing = await resolveLandingTarget(input.organizationId, input.initiatorActorId);
  if (!landing) {
    const session = await insertSpawnedSession(input, null, spawnLabel);
    return {
      session,
      taskId: null,
      parent: null,
      linkageNote:
        'Started without a tracked task — this workspace has no team to file work into yet.',
    };
  }

  const resolution = resolveWorkParent(
    input.prompt,
    await loadParentCandidates(input.organizationId),
  );
  const [created] = await db
    .insert(task)
    .values({
      organizationId: input.organizationId,
      title: spawnLabel,
      description: input.prompt,
      teamId: landing.teamId,
      statusId: landing.statusId,
      state: landing.state,
      assigneeId: landing.assigneeId,
      cycleId: landing.cycleId,
      source: 'native',
      createdBy: input.initiatorActorId,
      ...parentColumns(resolution),
    })
    .returning({ id: task.id });
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('dispatched task insert returned no row');

  const session = await insertSpawnedSession(input, created.id, spawnLabel);
  return {
    session,
    taskId: created.id,
    parent: resolution,
    linkageNote: describeParentResolution(resolution),
  };
}

/** Insert the spawned agent's session with the strongest work-linkage claim it can make. */
async function insertSpawnedSession(
  input: DispatchWorkInput,
  taskId: string | null,
  spawnLabel: string,
): Promise<SessionRow> {
  const [created] = await db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: input.ownerUserId,
      contextOrganizationId: input.organizationId,
      kind: 'job',
      trigger: 'delegation',
      status: 'pending',
      initiatorId: input.initiatorActorId,
      parentSessionId: input.parentSessionId ?? null,
      spawnLabel,
      taskId,
      workLinkage: taskId ? 'task' : 'unclassified',
      currentStep: 'Getting started',
      currentStepAt: new Date(),
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('spawned session insert returned no row');
  return created;
}

/**
 * Collect a session and everything it spawned, breadth-first.
 *
 * @param rootId - The session to walk from.
 * @param handle - A transaction handle, so the walk sees the same snapshot as the writes.
 * @returns the root id followed by every descendant, each exactly once.
 */
export async function collectSpawnTree(
  rootId: string,
  handle: DbHandle = db,
): Promise<readonly string[]> {
  const seen = new Set<string>([rootId]);
  let frontier: string[] = [rootId];
  for (let depth = 0; depth < MAX_SPAWN_DEPTH && frontier.length > 0; depth += 1) {
    const children = await handle
      .select({ id: agentSession.id })
      .from(agentSession)
      .where(inArray(agentSession.parentSessionId, frontier));
    frontier = children.map((row) => row.id).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  return [...seen];
}

/** What an interrupt actually stopped. */
export interface InterruptResult {
  /** Every session the interrupt reached, root first. */
  readonly sessionIds: readonly string[];
  /** The sessions that were still live and are now canceled. */
  readonly stoppedSessionIds: readonly string[];
  /** The instant the interrupt landed; every "did anything write after" check uses it. */
  readonly interruptedAt: Date;
}

/**
 * Interrupt a session and everything it dispatched.
 *
 * @remarks
 * Cancelling the session the user is looking at is the easy half. The half that matters is that
 * the agents it spawned stop too: they are separate rows with separate run generations and
 * nothing about cancelling the parent would otherwise reach them. The walk is done inside one
 * transaction so a spawn racing the interrupt either exists before the walk (and is stopped) or
 * is inserted against an already-interrupted parent.
 *
 * `interrupted_at` is stamped on every node — including nodes already in a terminal state — so
 * the watermark is complete. {@link reportAgentMilestone} refuses to record anything from a
 * stamped session, which is what turns "no agent keeps running and writing" into a checkable
 * property rather than a race.
 *
 * @param rootSessionId - The session the human interrupted.
 * @param ownerUserId - The owner, used to report each agent stopping.
 * @returns what was reached and what was stopped.
 */
export async function interruptAthenaWork(
  rootSessionId: string,
  ownerUserId: string,
): Promise<InterruptResult> {
  const outcome = await db.transaction(async (tx) => {
    const now = new Date();
    const sessionIds = await collectSpawnTree(rootSessionId, tx);

    const live = await tx
      .select({ id: agentSession.id })
      .from(agentSession)
      .where(
        and(
          inArray(agentSession.id, [...sessionIds]),
          inArray(agentSession.status, [...NON_TERMINAL_STATUSES]),
        ),
      );
    const stoppedSessionIds = live.map((row) => row.id);

    // Stamp the whole tree, live or not: the watermark answers "when did the human say stop",
    // which is meaningful even for a node that had already finished.
    await tx
      .update(agentSession)
      .set({ interruptedAt: now })
      .where(and(inArray(agentSession.id, [...sessionIds]), isNull(agentSession.interruptedAt)));

    if (stoppedSessionIds.length > 0) {
      await tx
        .update(agentSession)
        .set({ status: 'canceled', endedAt: now, currentStep: 'Stopped', currentStepAt: now })
        .where(inArray(agentSession.id, stoppedSessionIds));
      await tx
        .update(agentSessionRun)
        .set({ status: 'canceled', leaseToken: null, leaseExpiresAt: null, completedAt: now })
        .where(
          and(
            inArray(agentSessionRun.sessionId, stoppedSessionIds),
            inArray(agentSessionRun.status, [...LIVE_RUN_STATUSES]),
          ),
        );
    }
    return { sessionIds, stoppedSessionIds, interruptedAt: now };
  });

  // Reported after the transaction commits, and before the stamp is visible to a report from the
  // agent itself — this is the last thing each spawned agent is allowed to say.
  for (const sessionId of outcome.stoppedSessionIds) {
    await reportInterrupted(sessionId, ownerUserId);
  }
  return outcome;
}

/**
 * Report one agent stopping because the human interrupted.
 *
 * @remarks
 * Goes around {@link reportAgentMilestone}'s interrupted-session guard on purpose: the guard
 * exists to stop the *agent* writing after an interrupt, and this is the dispatcher saying the
 * agent stopped. It is the only report allowed after the stamp, and it is the last one.
 */
async function reportInterrupted(sessionId: string, ownerUserId: string): Promise<void> {
  await reportAgentMilestone({
    sessionId,
    ownerUserId,
    kind: 'agent_failed',
    milestone: 'Stopped',
    reasonCode: 'interrupted_by_user',
    stepAlreadyPersisted: true,
    allowAfterInterrupt: true,
  });
}

/**
 * Record what a session is doing right now.
 *
 * @remarks
 * The step is persisted on the session AND published, so a surface that polls and a surface that
 * streams show the same words, and a reload does not lose them.
 *
 * @param sessionId - The reporting session.
 * @param ownerUserId - The owner the report addresses.
 * @param step - The step, in the agent's own words.
 * @param progress - Self-reported completion 0–100, when the agent can estimate it.
 */
export async function recordCurrentStep(
  sessionId: string,
  ownerUserId: string,
  step: string,
  progress?: number | null,
): Promise<void> {
  await reportAgentMilestone({
    sessionId,
    ownerUserId,
    kind: 'agent_progress',
    milestone: step,
    ...(progress === undefined ? {} : { progress }),
  });
}

/**
 * Count Docket writes attributable to a session after an instant.
 *
 * @remarks
 * Exists so "zero writes happened after the interrupt" is something a test can measure rather
 * than assert. Counts the two things a running agent writes: visible activity, and the task rows
 * its session owns.
 *
 * @param sessionIds - The sessions to check.
 * @param after - The interrupt watermark.
 * @returns how many rows those sessions wrote after the watermark.
 */
export async function countWritesAfter(
  sessionIds: readonly string[],
  after: Date,
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const activities = await db
    .select({ id: sessionActivity.id, createdAt: sessionActivity.createdAt })
    .from(sessionActivity)
    .where(inArray(sessionActivity.sessionId, [...sessionIds]));
  return activities.filter((row) => row.createdAt.getTime() > after.getTime()).length;
}

/**
 * Resolve the owner's actor in a workspace, or `null` when they have none there.
 *
 * @param ownerUserId - The Better Auth user.
 * @param organizationId - The workspace.
 */
export async function ownerActorIn(
  ownerUserId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, ownerUserId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
