/**
 * `@docket/api` — the standing drain that takes agent-assigned Docket work out to an execution
 * surface and brings the answer back as a reviewable proposal.
 *
 * @remarks
 * ## What this closes
 *
 * Docket can already say "an agent should do this": a task's `delegate_id` names an agent Actor,
 * which is the data model's "you own it, the agent does it" (`docs/engineering/specs/data-model.md`
 * §`task.delegate_id`). Until this module existed, saying so did nothing — nothing scheduled ever
 * picked such a task up. This is the loop that does, on the tick that already runs.
 *
 * ## It adds no scheduling mechanism
 *
 * There is exactly one standing-Athena scheduler in this codebase: user-owned `athena_trigger`
 * rows, swept by {@link sweepAthenaAssignmentTriggers} behind
 * `POST /internal/cron/athena-triggers`, which `scripts/scheduler-setup.ts` provisions as
 * `docket-athena-triggers`. This drain rides that same tick as a second purpose, the way the
 * connector sweep carries the Notion mirror and the expired-session sweep carries the MCP reaper.
 * Its outcome is reported separately from the trigger sweep's so a failure in one can never be
 * hidden by the other's success, and it needs no new scheduler job to reach production.
 *
 * ## Who it runs as, and why that is the Lattice grant
 *
 * A delegated run has to act as somebody: it writes back into a workspace, and the write is
 * authorized against a real Actor. The recorded answer to "this person has authorized their own
 * hardware to carry Athena's work" is {@link latticeConnection} — per user, not per org, exactly
 * because the thing authorized is a person's own machine. So a person with an enabled connection
 * is a person whose agent-assigned backlog drains, and every submission and write-back is
 * attributed to them and re-authorized against their current access on every pass.
 *
 * That column's own doc frames `enabled` as "should Athena's *turns* run here". Reusing it for
 * delegated *work* widens it slightly; that is a deliberate choice over inventing a second opt-in
 * for the same machine, and it is the seam to revisit if the two ever need to be separable.
 *
 * ## Nothing is written to the task directly
 *
 * A returned result lands as a gated `action` activity — `approvalStatus: 'proposed'`, with a
 * stored `comment` tool call — on a session owned by that person, and the session parks in
 * `awaiting_approval`. That is the same proposal the agentic loop writes for a model-requested
 * write, and it is executed by the same approval path (`approveAndResume` →
 * `executeApprovedActions`). The drain has no privileged write of its own; a person still
 * approves before anything touches the task.
 *
 * The session itself is spawned through {@link dispatchAthenaWork}, which is this codebase's
 * single admission point for tracked agent work and the only module allowed to claim
 * `work_linkage = 'task'` — a rule `tests/agent/athena-architecture.test.ts` enforces against the
 * source tree.
 *
 * ## Idempotency
 *
 * The tick runs every minute, so a retry has to be free. Three guards, and they overlap on
 * purpose — each one alone is enough, which is what makes an interleaved pair of ticks safe:
 *
 * 1. `findCandidates` skips any task that already has a delegation which has not failed.
 * 2. The partial unique index `agent_delegation_open_task_uq` says the same thing as a
 *    constraint, so a race that gets past the query is rejected by the insert instead.
 * 3. The result claim is conditional on `status = 'submitted' AND result_activity_id IS NULL`,
 *    and only `submitted` rows are polled at all, so a finished delegation posts nothing twice.
 */
import {
  actor,
  agentDelegation,
  agentSession,
  agentSessionRun,
  db,
  genId,
  latticeConnection,
  sessionActivity,
  task,
  type AgentDelegationStatus,
} from '@docket/db';
import {
  DelegationUnavailableError,
  delegationOutputText,
  isTerminalDelegationState,
  type DelegationPoll,
  type DelegationPort,
  type DelegationUnavailableReason,
} from '@docket/integrations';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { getContainer } from '../container';
import { dispatchAthenaWork } from '../routes/agent-dispatch';
import { DOCKET_CONNECTION } from './toolbox';
import { resolveAssignmentAccess } from './assignments';

/** The execution surface these delegations are addressed to. */
const SURFACE = 'lattice';

/**
 * How many fresh tasks one pass hands out.
 *
 * @remarks
 * A bound, not a policy: the sweep runs on a tight cadence, so a backlog larger than this drains
 * over the following ticks rather than turning one tick into an unbounded fan-out of network
 * calls. Whatever a pass leaves behind is reported as {@link DelegationSweepResult.deferred} so a
 * long queue is visible rather than silently truncated.
 */
const MAX_SUBMISSIONS_PER_PASS = 10;

/**
 * How long a task waits after a failed delegation before it is handed out again.
 *
 * @remarks
 * Without this the drain is a hot loop: a pass settles a delegation as failed, the task becomes
 * eligible in the same pass, and an unreachable runtime gets hammered once a minute forever. A
 * quarter of an hour is short enough that a transient outage costs one cycle of work and long
 * enough that a persistent one is not a denial-of-service against the person's own machine.
 */
const RETRY_COOLDOWN_MS = 15 * 60_000;

/** Outcome counts for one pass of the delegation drain. */
export interface DelegationSweepResult {
  /** Tasks handed to the delegation surface this pass. */
  readonly submitted: number;
  /** Outstanding delegations polled this pass. */
  readonly polled: number;
  /** Delegations whose finished work was posted back as a proposal. */
  readonly posted: number;
  /** Delegations that ended without a usable result, or whose submission failed. */
  readonly failed: number;
  /** Delegation sessions closed out after their proposal was decided. */
  readonly closed: number;
  /** Eligible tasks this pass did not reach, left for the next tick. */
  readonly deferred: number;
}

/** A zero pass, used when nothing is configured or nobody is eligible. */
const EMPTY: DelegationSweepResult = {
  submitted: 0,
  polled: 0,
  posted: 0,
  failed: 0,
  closed: 0,
  deferred: 0,
};

/** One outstanding delegation joined to the task it came from. */
type OutstandingRow = typeof agentDelegation.$inferSelect;

/** Read the stable reason out of a thrown delegation failure, without trusting its message. */
function failureReason(error: unknown): DelegationUnavailableReason | 'unexpected_error' {
  return error instanceof DelegationUnavailableError ? error.reason : 'unexpected_error';
}

/** Diagnostic detail for a persisted failure. Read by operators; never rendered as UI copy. */
function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a thrown poll failure is worth trying again on the next tick.
 *
 * @remarks
 * A surface that cannot reach a runtime right now may reach it in a minute, so the delegation
 * stays outstanding. A surface that has never heard of the work id, or that has expired it, will
 * never say anything different — those settle the row so the task becomes re-delegatable.
 */
function isRetryablePollFailure(reason: DelegationUnavailableReason | 'unexpected_error'): boolean {
  return reason !== 'unknown_work' && reason !== 'work_expired';
}

/**
 * The instruction one delegated task carries.
 *
 * @remarks
 * Everything the remote agent needs in one statement, because it cannot ask a follow-up — the
 * delegation surface's own tool description makes that explicit. The title is the task; the
 * description, when there is one, is the detail.
 */
function instructionFor(row: { title: string; description: string | null }): string {
  const detail = row.description?.trim();
  return detail ? `${row.title}\n\n${detail}` : row.title;
}

/**
 * The comment body a returned result is proposed as.
 *
 * @remarks
 * Docket-owned framing around the remote agent's own words, with the provenance a reviewer needs
 * to judge it: which machine ran it, and which delegation record it came from. A result whose
 * payload carries no readable report still gets a comment — silence about work that ran would be
 * worse than a short note that it produced nothing to read.
 */
function resultComment(
  delegation: OutstandingRow,
  poll: DelegationPoll,
  reportText: string | null,
): string {
  const machine = delegation.runtimeName ?? delegation.runtimeId ?? 'a delegated runtime';
  const header = `Delegated run on ${machine} finished as \`${poll.result?.outcome ?? poll.state}\`.`;
  const body = reportText ?? 'The run returned no written report.';
  return `${header}\n\n${body}\n\n_Delegation \`${delegation.id}\` · work \`${delegation.externalWorkId}\`._`;
}

/**
 * Settle one delegation row that will not produce a usable result.
 *
 * @remarks
 * The task keeps its `delegate_id`, and the partial unique index only excludes rows still in
 * `submitted`, so settling here is exactly what makes the work re-delegatable on a later tick.
 * The reason and its detail are persisted rather than logged and dropped: a delegation that
 * failed silently would be indistinguishable from one that never ran.
 */
async function settleFailed(
  delegationId: string,
  workState: string,
  reason: string,
  detail: string,
  outcome: string | null,
  now: Date,
): Promise<boolean> {
  const [settled] = await db
    .update(agentDelegation)
    .set({
      status: 'failed' satisfies AgentDelegationStatus,
      workState,
      outcome,
      lastFailureReason: reason,
      lastFailureDetail: detail,
      lastPolledAt: now,
      completedAt: now,
    })
    .where(and(eq(agentDelegation.id, delegationId), eq(agentDelegation.status, 'submitted')))
    .returning({ id: agentDelegation.id });
  if (!settled) return false;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ sessionId: agentDelegation.sessionId })
      .from(agentDelegation)
      .where(eq(agentDelegation.id, delegationId))
      .limit(1);
    if (!row?.sessionId) return;
    // The failure is visible in the person's own activity stream, not only in the row. `error`
    // activities carry no organization: this one is about the delegation, not about workspace
    // content, and the reason is a stable code rather than provider prose.
    await tx.insert(sessionActivity).values({
      sessionId: row.sessionId,
      organizationId: null,
      type: 'error',
      body: { text: `delegation_failed:${reason}`, delegationId },
    });
    await tx
      .update(agentSession)
      .set({ status: 'failed', endedAt: now })
      .where(eq(agentSession.id, row.sessionId));
  });
  return true;
}

/**
 * Post one finished delegation's result as a gated proposal, claiming the row as it goes.
 *
 * @remarks
 * The conditional update is the idempotency guard, and it runs first inside the transaction: a
 * second pass over the same finished delegation matches nothing, rolls back, and posts no second
 * proposal. Only after the claim succeeds is the proposal written, so the row and the activity
 * can never disagree about whether the result has been delivered.
 *
 * @param delegation - The outstanding delegation row.
 * @param sessionId - The session the proposal hangs off, already narrowed to non-null.
 * @param poll - The poll that carried the terminal result.
 * @param now - The sweep clock.
 * @returns true when this call is the one that posted it.
 */
async function postResultProposal(
  delegation: OutstandingRow,
  sessionId: string,
  poll: DelegationPoll,
  now: Date,
): Promise<boolean> {
  const reportText = delegationOutputText(poll.result?.payload);
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        status: 'completed' satisfies AgentDelegationStatus,
        workState: poll.state,
        outcome: poll.result?.outcome ?? null,
        lastPolledAt: now,
        completedAt: now,
      })
      .where(
        and(
          eq(agentDelegation.id, delegation.id),
          eq(agentDelegation.status, 'submitted'),
          isNull(agentDelegation.resultActivityId),
        ),
      )
      .returning({ id: agentDelegation.id });
    if (!claimed) return false;

    const [activity] = await tx
      .insert(sessionActivity)
      .values({
        sessionId,
        organizationId: delegation.organizationId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: genId(),
        body: {
          action: {
            kind: 'comment',
            summary: `comment: delegated result for task ${delegation.taskId}`,
            toolCall: {
              connection: DOCKET_CONNECTION,
              tool: 'comment',
              input: {
                orgId: delegation.organizationId,
                subjectType: 'task',
                subjectId: delegation.taskId,
                body: resultComment(delegation, poll, reportText),
              },
              toolUseId: `delegation_${delegation.id}`,
            },
            mode: 'proposal',
          },
        },
      })
      .returning({ id: sessionActivity.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!activity) throw new Error('delegation proposal insert returned no row');

    await tx
      .update(agentDelegation)
      .set({ resultActivityId: activity.id })
      .where(eq(agentDelegation.id, delegation.id));
    await tx
      .update(agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(agentSession.id, sessionId));
    return true;
  });
}

/**
 * Poll every outstanding delegation once and settle whatever finished.
 *
 * @param client - The delegation surface.
 * @param now - The sweep clock.
 * @returns partial counts for the polling half of the pass.
 */
async function drainOutstanding(
  client: DelegationPort,
  now: Date,
): Promise<Pick<DelegationSweepResult, 'polled' | 'posted' | 'failed'>> {
  const outstanding = await db
    .select()
    .from(agentDelegation)
    .where(and(eq(agentDelegation.status, 'submitted'), eq(agentDelegation.surface, SURFACE)));
  let polled = 0;
  let posted = 0;
  let failed = 0;

  for (const delegation of outstanding) {
    let poll: DelegationPoll;
    try {
      poll = await client.poll(delegation.externalWorkId);
    } catch (error) {
      const reason = failureReason(error);
      if (isRetryablePollFailure(reason)) {
        // Still outstanding: record what went wrong and try again next tick. The row stays in
        // `submitted`, so the task is neither re-delegated nor forgotten.
        await db
          .update(agentDelegation)
          .set({
            lastFailureReason: reason,
            lastFailureDetail: failureDetail(error),
            lastPolledAt: now,
            pollCount: sql`${agentDelegation.pollCount} + 1`,
          })
          .where(eq(agentDelegation.id, delegation.id));
        polled += 1;
        continue;
      }
      if (
        await settleFailed(
          delegation.id,
          delegation.workState,
          reason,
          failureDetail(error),
          null,
          now,
        )
      ) {
        failed += 1;
      }
      polled += 1;
      continue;
    }

    polled += 1;
    await db
      .update(agentDelegation)
      .set({
        workState: poll.state,
        lastPolledAt: now,
        pollCount: sql`${agentDelegation.pollCount} + 1`,
      })
      .where(eq(agentDelegation.id, delegation.id));

    if (!isTerminalDelegationState(poll.state)) continue;

    const outcome = poll.result?.outcome ?? null;
    if (poll.result && outcome === 'completed' && delegation.sessionId) {
      if (await postResultProposal(delegation, delegation.sessionId, poll, now)) {
        posted += 1;
      }
      continue;
    }
    // Terminal but not usable: the runtime failed, was cancelled, expired, or could not open the
    // work at all. Every one of those is recorded with its outcome and leaves the task
    // re-delegatable rather than stuck mid-flight.
    if (
      await settleFailed(
        delegation.id,
        poll.state,
        outcome ? `delegation_${outcome}` : `delegation_${poll.state}`,
        outcome
          ? `The delegated run ended as ${outcome}.`
          : `The delegated run ended without a result.`,
        outcome,
        now,
      )
    ) {
      failed += 1;
    }
  }

  return { polled, posted, failed };
}

/**
 * Close out delegation sessions whose proposal has been decided and whose work is over.
 *
 * @remarks
 * A delegation session holds no conversation — it exists to carry one gated proposal — so the
 * approval path has nothing to resume and leaves it `running` once the proposal is applied or
 * rejected. That is the platform's normal outcome for a transcript-less session, and it is fine
 * for the approval path; it is not fine to leave behind, because a session stuck in `running` is
 * rendered as work still in progress. Closing them is exactly the janitorial job a sweep is for.
 *
 * Only sessions with no live run generation are touched, so this can never stomp a generation
 * another process is mid-way through.
 *
 * @param now - The sweep clock.
 * @returns how many sessions this pass closed.
 */
async function closeFinishedSessions(now: Date): Promise<number> {
  const closed = await db
    .update(agentSession)
    .set({ status: 'completed', endedAt: now })
    .where(
      and(
        eq(agentSession.trigger, 'delegation'),
        eq(agentSession.status, 'running'),
        sql`exists (
          select 1 from ${agentDelegation}
          where ${agentDelegation.sessionId} = ${agentSession.id}
            and ${agentDelegation.status} <> 'submitted'
        )`,
        // Every action decided, none still awaiting or mid-execution.
        sql`not exists (
          select 1 from ${sessionActivity}
          where ${sessionActivity.sessionId} = ${agentSession.id}
            and ${sessionActivity.type} = 'action'
            and ${sessionActivity.approvalStatus} in ('proposed','approved','executing')
        )`,
        sql`not exists (
          select 1 from ${agentSessionRun}
          where ${agentSessionRun.sessionId} = ${agentSession.id}
            and ${agentSessionRun.status} = 'running'
        )`,
      ),
    )
    .returning({ id: agentSession.id });
  return closed.length;
}

/** One agent-assigned task eligible to be handed out, with the owner who will carry it. */
interface Candidate {
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly delegateActorId: string;
  readonly title: string;
  readonly description: string | null;
}

/**
 * Find every agent-assigned task that a Lattice-enabled person can currently carry.
 *
 * @remarks
 * "Agent-assigned" is `task.delegate_id` pointing at an Actor with `kind = 'agent'` — the data
 * model's own delegation edge, not a new flag. Completed, canceled, and archived tasks are
 * excluded because nobody wants an agent grinding on finished work.
 *
 * The anti-join excludes any delegation that has not failed, not merely one still in flight. A
 * task whose delegated run already came back has its answer sitting in a proposal waiting on a
 * person; handing it out again on the next tick would grind the same work forever and bury the
 * reviewer. Only a failed attempt makes a task eligible again, and
 * `agent_delegation_open_task_uq` enforces the same rule as a constraint so a race cannot get
 * around it.
 *
 * A task whose last attempt failed inside {@link RETRY_COOLDOWN_MS} is also held back, so a
 * failure settled earlier in this very pass cannot be re-submitted before the pass ends.
 *
 * @param now - The sweep clock, against which the retry cooldown is measured.
 * @returns candidates in a stable order, oldest task first.
 */
async function findCandidates(now: Date): Promise<Candidate[]> {
  const owners = await db
    .select({ ownerUserId: latticeConnection.ownerUserId })
    .from(latticeConnection)
    .where(
      and(
        eq(latticeConnection.enabled, true),
        eq(latticeConnection.status, 'connected'),
        isNotNull(latticeConnection.deviceId),
      ),
    );
  if (owners.length === 0) return [];
  const ownerIds = owners.map((row) => row.ownerUserId);

  const delegateActor = alias(actor, 'delegate_actor');
  const memberActor = alias(actor, 'member_actor');
  // One query rather than one per person: the membership join is what scopes each candidate to an
  // owner, and the anti-join on outstanding delegations is what keeps a task from being handed out
  // twice. Access is still rechecked per candidate below — this only narrows the set.
  const rows = await db
    .select({
      ownerUserId: memberActor.userId,
      taskId: task.id,
      organizationId: task.organizationId,
      delegateActorId: delegateActor.id,
      title: task.title,
      description: task.description,
    })
    .from(task)
    .innerJoin(delegateActor, eq(delegateActor.id, task.delegateId))
    .innerJoin(
      memberActor,
      and(
        eq(memberActor.organizationId, task.organizationId),
        eq(memberActor.kind, 'human'),
        eq(memberActor.status, 'active'),
        isNull(memberActor.archivedAt),
        inArray(memberActor.userId, ownerIds),
      ),
    )
    .where(
      and(
        eq(delegateActor.kind, 'agent'),
        isNull(task.completedAt),
        isNull(task.canceledAt),
        isNull(task.archivedAt),
        sql`not exists (
          select 1 from ${agentDelegation}
          where ${agentDelegation.taskId} = ${task.id}
            and (
              ${agentDelegation.status} <> 'failed'
              or ${agentDelegation.completedAt} > ${new Date(now.getTime() - RETRY_COOLDOWN_MS)}
            )
        )`,
      ),
    )
    .orderBy(task.createdAt);
  // `actor.user_id` is nullable in general; the join already restricted these rows to the human
  // Actors of the owners we selected, so this narrows the type without discarding anything.
  return rows.filter((row): row is Candidate => row.ownerUserId !== null);
}

/**
 * Hand one candidate to the delegation surface.
 *
 * @remarks
 * The row is inserted before the network call, not after. That insert is the claim: the partial
 * unique index rejects a second one for the same task, so two overlapping ticks cannot both reach
 * `submit`. Until the surface answers, the row holds a locally minted pending work id, and the
 * row's own id travels as the surface's idempotency key so even the retry window cannot open two
 * units of remote work.
 *
 * @returns 'submitted' when the surface took it, 'failed' when it could not, 'skipped' when
 *   another pass already claimed the task or the owner no longer has access.
 */
async function submitCandidate(
  candidate: Candidate,
  client: DelegationPort,
  now: Date,
): Promise<'submitted' | 'failed' | 'skipped'> {
  const access = await resolveAssignmentAccess({
    ownerUserId: candidate.ownerUserId,
    organizationId: candidate.organizationId,
    entityType: 'task',
    entityId: candidate.taskId,
  });
  if (!access) return 'skipped';

  const pendingWorkId = `pending:${genId()}`;
  const claimed = await db
    .insert(agentDelegation)
    .values({
      taskId: candidate.taskId,
      organizationId: candidate.organizationId,
      ownerUserId: candidate.ownerUserId,
      delegateActorId: candidate.delegateActorId,
      surface: SURFACE,
      externalWorkId: pendingWorkId,
      workState: 'pending',
      status: 'submitted',
    })
    .onConflictDoNothing()
    .returning();
  const delegation = claimed[0];
  if (!delegation) return 'skipped';

  // Through the dispatcher, never around it: `agent-dispatch` is the single admission point for
  // tracked Athena work and the only place `work_linkage = 'task'` may be claimed. The task
  // already exists, so this spawns the session against it rather than creating one. No parent
  // session — this work has no conversational origin, it came off a schedule.
  const { session } = await dispatchAthenaWork({
    ownerUserId: candidate.ownerUserId,
    prompt: instructionFor(candidate),
    organizationId: candidate.organizationId,
    initiatorActorId: access.actorId,
    taskId: candidate.taskId,
  });
  await db
    .update(agentSession)
    .set({ externalRunRef: `agent-delegation:${delegation.id}` })
    .where(eq(agentSession.id, session.id));
  await db
    .update(agentDelegation)
    .set({ sessionId: session.id })
    .where(eq(agentDelegation.id, delegation.id));

  try {
    const submission = await client.submit({
      instruction: instructionFor(candidate),
      logicalSubmissionId: delegation.id,
      metadata: {
        source: 'docket',
        taskId: candidate.taskId,
        organizationId: candidate.organizationId,
        delegationId: delegation.id,
      },
    });
    await db
      .update(agentDelegation)
      .set({
        externalWorkId: submission.workId,
        workState: submission.state,
        runtimeId: submission.runtimeId,
        runtimeName: submission.runtimeName,
        deadlineAt: new Date(submission.deadlineAt),
        lastFailureReason: null,
        lastFailureDetail: null,
      })
      .where(eq(agentDelegation.id, delegation.id));
    return 'submitted';
  } catch (error) {
    // The claim is released by settling, not by deleting: the attempt and its reason stay on the
    // record, and the task becomes eligible again on the next tick.
    await settleFailed(
      delegation.id,
      'pending',
      failureReason(error),
      failureDetail(error),
      null,
      now,
    );
    return 'failed';
  }
}

/**
 * Run one pass of the standing delegation drain: poll what is out, then hand out what is next.
 *
 * @remarks
 * Polling runs first so a machine that finished between ticks has its result posted before this
 * pass considers giving out more work, and so a delegation that settles frees its task in the
 * same pass. Every step is claimed in the database, so a scheduler retry or an overlapping tick
 * is a no-op rather than a duplicate.
 *
 * A deployment with no delegation surface configured does nothing at all and says so, rather
 * than failing every eligible task on every tick.
 *
 * @param now - The sweep clock; read at request time, never at module scope.
 * @returns what the pass did.
 */
export async function sweepAgentDelegations(
  now: Date = new Date(),
): Promise<DelegationSweepResult> {
  const client = getContainer().delegation;
  if (!client) return EMPTY;

  const drained = await drainOutstanding(client, now);
  const closed = await closeFinishedSessions(now);
  const candidates = await findCandidates(now);
  const batch = candidates.slice(0, MAX_SUBMISSIONS_PER_PASS);

  let submitted = 0;
  let failed = drained.failed;
  for (const candidate of batch) {
    const outcome = await submitCandidate(candidate, client, now);
    if (outcome === 'submitted') submitted += 1;
    if (outcome === 'failed') failed += 1;
  }

  return {
    submitted,
    polled: drained.polled,
    posted: drained.posted,
    failed,
    closed,
    deferred: candidates.length - batch.length,
  };
}
