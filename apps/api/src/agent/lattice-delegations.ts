/** Durable Docket ownership for personal Athena work submitted through Lovelace Lattice. */
import {
  actor,
  agentDelegation,
  agentSession,
  athenaAssignment,
  db,
  genId,
  latticeConnection,
  sessionActivity,
} from '@docket/db';
import { canActor } from '@docket/authz';
import { LatticeUnavailableError } from '@docket/integrations';
import type {
  RelayRuntimeRegistrationView,
  RelaySealedEnvelope,
  RelayWorkEventsResponse,
  RelayWorkExpiryEvent,
  RelayWorkProgressEvent,
  RelayWorkResultAcknowledged,
  RelayWorkResultEvent,
} from '@lovelace-ai/compute';
import {
  RelayControllerError,
  type BuildAgentTaskOptions,
  type RelayWorkState,
  type SubmittedWork,
  type SubmitWorkOptions,
} from '@lovelace-ai/lattice-relay-client';
import type { WorkKeyPair } from '@lovelace-ai/lattice-relay-crypto';
import { and, asc, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';

import { sealCredential, unsealCredential } from '../lib/credentials';
import type { AthenaAssignmentRow } from './assignments';
import type { LatticeConnectionRow } from '../routes/lattice-connection';

const STANDARD_DEADLINE_MS = 120_000;
const MAX_POLL_BATCH = 10;
const MAX_SUBMIT_BATCH = 10;
const TRANSIENT_RETRY_MS = 5_000;
const SUBMISSION_LEASE_MS = 30_000;
const SUBMISSION_DEADLINE_GRACE_MS = 5_000;

type SurfaceWorkEventsResponse = Omit<RelayWorkEventsResponse, 'state'> & {
  readonly state: RelayWorkState;
};

/** The wire and crypto boundary implemented by the official Lovelace packages. */
export interface LatticeDelegationDependencies {
  readonly generateReplyKey: (keyId: string) => Promise<WorkKeyPair>;
  readonly buildAgentTaskCommand: (input: BuildAgentTaskOptions) => unknown;
  readonly listRuntimes: (
    connection: LatticeConnectionRow,
  ) => Promise<readonly RelayRuntimeRegistrationView[]>;
  readonly submitWork: (
    connection: LatticeConnectionRow,
    input: SubmitWorkOptions,
  ) => Promise<SubmittedWork>;
  readonly pollEvents: (
    connection: LatticeConnectionRow,
    workId: string,
    cursor: string,
  ) => Promise<SurfaceWorkEventsResponse>;
  readonly openWork: (
    envelope: RelaySealedEnvelope,
    privateKey: string,
    aad: { readonly latticeId: string; readonly workId: string },
  ) => Promise<unknown>;
  readonly cancelWork: (
    connection: LatticeConnectionRow,
    workId: string,
  ) => Promise<Pick<SubmittedWork, 'state'>>;
  readonly acknowledgeResult: (
    connection: LatticeConnectionRow,
    workId: string,
  ) => Promise<Pick<SubmittedWork, 'state'> & Pick<RelayWorkResultAcknowledged, 'acknowledgedAt'>>;
}

/** Counts returned by one bounded scheduler pass. */
export interface LatticeDelegationSweepResult {
  readonly polled: number;
  readonly submitted: number;
  readonly proposed: number;
  readonly failed: number;
  readonly canceled: number;
  readonly acknowledged: number;
}

/** Independent emergency controls for relay reads and new submissions. */
export interface LatticeDelegationSweepOptions {
  readonly pollingEnabled: boolean;
  readonly submissionsEnabled: boolean;
}

interface StoredReplyKey extends WorkKeyPair {
  readonly keyId: string;
}

type LatticeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function storeReplyKey(key: StoredReplyKey): string {
  return sealCredential(JSON.stringify(key));
}

function loadReplyKey(ciphertext: string): StoredReplyKey {
  const parsed = JSON.parse(unsealCredential(ciphertext)) as Partial<StoredReplyKey>;
  /* v8 ignore next -- @preserve defensive: a sealed reply key Docket wrote always has all three fields */
  if (
    typeof parsed.keyId !== 'string' ||
    typeof parsed.publicKey !== 'string' ||
    typeof parsed.privateKey !== 'string'
  ) {
    throw new Error('stored Lattice reply key is invalid');
  }
  return parsed as StoredReplyKey;
}

/**
 * Create the Docket session and prepared delegation before any relay request can leave Docket.
 */
export async function prepareLatticeAssignmentRun(
  assignment: AthenaAssignmentRow,
  actorId: string,
  prompt: string,
  externalRunRef: string,
  connection: LatticeConnectionRow,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<string> {
  if (!connection.enabled || !connection.deviceId) {
    throw new Error('an enabled Lattice connection with a selected runtime is required');
  }
  const runtimeId = connection.deviceId;
  const delegationId = genId();
  const workId = `work_${genId()}`;
  const logicalSubmissionId = `athena:${delegationId}`;
  const replyKey = await deps.generateReplyKey(`docket-reply-${workId}`);
  const replyKeyCiphertext = storeReplyKey(replyKey);
  const deadlineAt = new Date(now.getTime() + STANDARD_DEADLINE_MS);

  return await db.transaction(async (tx) => {
    const [lockedAssignment] = await tx
      .select({ id: athenaAssignment.id })
      .from(athenaAssignment)
      .where(
        and(
          eq(athenaAssignment.id, assignment.id),
          eq(athenaAssignment.ownerUserId, assignment.ownerUserId),
        ),
      )
      .for('update')
      .limit(1);
    /* v8 ignore next -- @preserve defensive: the row is locked for update in this transaction */
    if (!lockedAssignment) throw new Error('Athena assignment is no longer available');
    const [existing] = await tx
      .select({ sessionId: agentDelegation.sessionId })
      .from(agentDelegation)
      .where(
        and(
          eq(agentDelegation.assignmentId, assignment.id),
          eq(agentDelegation.ownerUserId, assignment.ownerUserId),
          or(
            eq(agentDelegation.status, 'prepared'),
            eq(agentDelegation.status, 'submitted'),
            eq(agentDelegation.status, 'proposed'),
          ),
        ),
      )
      .limit(1);
    if (existing) return existing.sessionId;

    const [session] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: assignment.ownerUserId,
        contextOrganizationId: assignment.organizationId,
        taskId: assignment.entityType === 'task' ? assignment.entityId : null,
        trigger: 'assignment',
        executionSurface: 'lattice',
        status: 'pending',
        initiatorId: actorId,
        externalRunRef,
        currentStep: 'Waiting to submit to the selected Lattice runtime',
        currentStepAt: now,
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!session) throw new Error('Lattice assignment session insert returned no row');
    await tx.insert(sessionActivity).values({
      sessionId: session.id,
      organizationId: null,
      type: 'response',
      body: { text: prompt, author: 'user', assignmentId: assignment.id },
    });
    await tx.insert(agentDelegation).values({
      id: delegationId,
      ownerUserId: assignment.ownerUserId,
      organizationId: assignment.organizationId,
      assignmentId: assignment.id,
      sessionId: session.id,
      taskId: assignment.entityType === 'task' ? assignment.entityId : null,
      connectionId: connection.id,
      runtimeId,
      logicalSubmissionId,
      workId,
      replyKeyCiphertext,
      latticeAccountId: connection.accountId,
      status: 'prepared',
      nextPollAt: now,
      deadlineAt,
    });
    await tx
      .update(athenaAssignment)
      .set({ activeSessionId: session.id, pausedReason: null })
      .where(
        and(
          eq(athenaAssignment.id, assignment.id),
          eq(athenaAssignment.ownerUserId, assignment.ownerUserId),
        ),
      );
    return session.id;
  });
}

function usableWorkKey(
  runtime: RelayRuntimeRegistrationView,
  now: Date,
): RelayRuntimeRegistrationView['workKeys'][number] | null {
  return (
    runtime.workKeys.find((key) => {
      if (key.revokedAt) return false;
      const notBefore = new Date(key.notBefore).getTime();
      const notAfter = new Date(key.notAfter).getTime();
      return notBefore <= now.getTime() && now.getTime() < notAfter;
    }) ?? null
  );
}

function proposalExecutionFailed(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const action = (body as Record<string, unknown>)['action'];
  if (!action || typeof action !== 'object') return false;
  const result = (action as Record<string, unknown>)['result'];
  return Boolean(
    result && typeof result === 'object' && (result as Record<string, unknown>)['isError'] === true,
  );
}

/** Settle locally decided proposals outside Athena's conversational turn handler. */
async function reconcileDecidedProposals(now: Date): Promise<void> {
  const decided = await db
    .select({
      delegationId: agentDelegation.id,
      sessionId: agentDelegation.sessionId,
      approvalStatus: sessionActivity.approvalStatus,
      body: sessionActivity.body,
    })
    .from(agentDelegation)
    .innerJoin(sessionActivity, eq(agentDelegation.returnedActivityId, sessionActivity.id))
    .where(eq(agentDelegation.status, 'proposed'))
    .orderBy(asc(agentDelegation.createdAt))
    .limit(MAX_POLL_BATCH);

  for (const row of decided) {
    if (row.approvalStatus !== 'applied' && row.approvalStatus !== 'rejected') continue;
    const executionFailed = row.approvalStatus === 'applied' && proposalExecutionFailed(row.body);
    await db.transaction(async (tx) => {
      const delegationUpdate =
        row.approvalStatus === 'rejected'
          ? {
              status: 'canceled' as const,
              replyKeyCiphertext: null,
              returnedActivityId: null,
              nextPollAt: now,
              settledAt: now,
            }
          : executionFailed
            ? {
                status: 'failed' as const,
                failureCode: 'task_comment_failed',
                replyKeyCiphertext: null,
                returnedActivityId: null,
                nextPollAt: now,
                settledAt: now,
              }
            : {
                status: 'completed' as const,
                failureCode: null,
                replyKeyCiphertext: null,
                nextPollAt: now,
                settledAt: now,
              };
      const [claimed] = await tx
        .update(agentDelegation)
        .set(delegationUpdate)
        .where(
          and(eq(agentDelegation.id, row.delegationId), eq(agentDelegation.status, 'proposed')),
        )
        .returning({ id: agentDelegation.id });
      /* v8 ignore next -- @preserve defensive: another pass settled this decided proposal first */
      if (!claimed) return;

      const sessionUpdate =
        row.approvalStatus === 'rejected'
          ? {
              status: 'canceled' as const,
              currentStep: 'The Lattice result was rejected',
              currentStepAt: now,
              endedAt: now,
            }
          : executionFailed
            ? {
                status: 'failed' as const,
                currentStep: failureMessage('task_comment_failed'),
                currentStepAt: now,
                endedAt: now,
              }
            : {
                status: 'completed' as const,
                currentStep: 'The Lattice result was added to the assigned task',
                currentStepAt: now,
                endedAt: now,
              };
      await tx.update(agentSession).set(sessionUpdate).where(eq(agentSession.id, row.sessionId));
    });
  }
}

async function promptForSession(sessionId: string): Promise<string> {
  const [row] = await db
    .select({ body: sessionActivity.body })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')))
    .orderBy(asc(sessionActivity.createdAt))
    .limit(1);
  const text = row?.body.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('prepared Lattice delegation has no instruction');
  }
  return text;
}

async function settleFailure(
  delegationId: string,
  sessionId: string,
  code: string,
  workState: string | null,
  now: Date,
  options: {
    readonly terminalOutcome?: { readonly outcome: string; readonly payload?: unknown };
    readonly retainReplyKey?: boolean;
    readonly relayCursor?: string;
  } = {},
): Promise<boolean> {
  return await db.transaction(async (tx) =>
    settleFailureInTransaction(tx, delegationId, sessionId, code, workState, now, options),
  );
}

async function settleFailureInTransaction(
  tx: LatticeTransaction,
  delegationId: string,
  sessionId: string,
  code: string,
  workState: string | null,
  now: Date,
  options: {
    readonly terminalOutcome?: { readonly outcome: string; readonly payload?: unknown };
    readonly retainReplyKey?: boolean;
    readonly relayCursor?: string;
  } = {},
): Promise<boolean> {
  const [claimed] = await tx
    .update(agentDelegation)
    .set({
      status: 'failed',
      failureCode: code,
      workState,
      submissionLeaseToken: null,
      submissionLeaseExpiresAt: null,
      cancellationRequestedAt: null,
      ...(options.retainReplyKey ? {} : { replyKeyCiphertext: null }),
      ...(options.relayCursor ? { relayCursor: options.relayCursor } : {}),
      terminalOutcome: options.terminalOutcome,
      returnedActivityId: null,
      nextPollAt: null,
      settledAt: now,
    })
    .where(
      and(
        eq(agentDelegation.id, delegationId),
        or(eq(agentDelegation.status, 'prepared'), eq(agentDelegation.status, 'submitted')),
      ),
    )
    .returning({ id: agentDelegation.id });
  /* v8 ignore next -- @preserve defensive: another pass settled this delegation first */
  if (!claimed) return false;
  await tx.insert(sessionActivity).values({
    sessionId,
    organizationId: null,
    type: 'error',
    body: { text: failureMessage(code), code, source: 'lattice' },
  });
  await tx
    .update(agentSession)
    .set({
      status: 'failed',
      currentStep: failureMessage(code),
      currentStepAt: now,
      endedAt: now,
    })
    .where(eq(agentSession.id, sessionId));
  return true;
}

async function settleCanceled(
  delegationId: string,
  sessionId: string,
  workState: string | null,
  now: Date,
  terminalOutcome?: { readonly outcome: string; readonly payload?: unknown },
  relayCursor?: string,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        status: 'canceled',
        workState,
        submissionLeaseToken: null,
        submissionLeaseExpiresAt: null,
        cancellationRequestedAt: null,
        failureCode: null,
        replyKeyCiphertext: null,
        terminalOutcome,
        ...(relayCursor ? { relayCursor } : {}),
        nextPollAt: null,
        settledAt: now,
      })
      .where(
        and(
          eq(agentDelegation.id, delegationId),
          or(eq(agentDelegation.status, 'prepared'), eq(agentDelegation.status, 'submitted')),
        ),
      )
      .returning({ id: agentDelegation.id });
    /* v8 ignore next -- @preserve defensive: another pass settled this delegation first */
    if (!claimed) return false;
    await tx
      .update(agentSession)
      .set({
        status: 'canceled',
        currentStep: 'The Lattice assignment was canceled',
        currentStepAt: now,
        interruptedAt: now,
        endedAt: now,
      })
      .where(eq(agentSession.id, sessionId));
    return true;
  });
}

/**
 * Report one settlement attempt as a sweep outcome. A claim this pass did not win means another
 * pass already settled the delegation, and this one has nothing left to report.
 */
function settledAs<T extends string>(claimed: boolean, outcome: T): T | 'skipped' {
  /* v8 ignore next -- @preserve defensive: a settlement this pass did not claim belongs to another pass */
  return claimed ? outcome : 'skipped';
}

/** The same report for the scheduler's cancellation pass, which retries what it cannot claim. */
function settledOrPending<T extends string>(claimed: boolean, outcome: T): T | 'pending' {
  /* v8 ignore next -- @preserve defensive: a settlement this pass did not claim belongs to another pass */
  return claimed ? outcome : 'pending';
}

function failureMessage(code: string): string {
  switch (code) {
    case 'access_lost':
      return 'Athena stopped because you no longer have access to the assigned work.';
    case 'oauth_invalid':
      return 'Athena stopped because the Lattice connection needs authorization again.';
    case 'scope_missing':
      return 'Athena stopped because the Lattice connection does not grant compute access.';
    case 'result_decryption_failed':
      return 'Athena could not verify the encrypted result returned by Lattice.';
    case 'result_key_invalid':
      return 'Athena could not open the saved key for this Lattice assignment.';
    case 'runtime_key_expired':
      return 'Athena stopped because the Mac Studio work key expired.';
    case 'runtime_not_found':
      return 'Athena could not find the selected Mac Studio in this Lattice account.';
    case 'submission_rejected':
      return 'Athena could not submit this assignment to the selected Mac Studio.';
    case 'relay_unavailable':
      return 'Athena is waiting for the Lovelace Lattice relay to respond.';
    case 'unknown_work':
      return 'Athena stopped because Lattice no longer recognizes this assignment.';
    case 'work_expired':
      return 'Athena did not receive the Lattice result before it expired.';
    case 'execution_failed':
      return 'Athena could not finish the assignment on the selected Mac Studio.';
    case 'result_invalid':
      return 'Athena received a Lattice result that did not contain a usable report.';
    case 'task_comment_failed':
      return 'Athena could not add the Lattice result to the assigned task.';
    /* v8 ignore next -- @preserve defensive: every settlement code this module writes has its own message */
    default:
      return 'Athena could not finish the Lattice assignment.';
  }
}

function authorizationFailureCode(cause: unknown): 'oauth_invalid' | 'scope_missing' | null {
  if (!(cause instanceof LatticeUnavailableError)) return null;
  if (cause.reason === 'insufficient_scopes') return 'scope_missing';
  if (cause.reason === 'not_connected' || cause.reason === 'authorization_expired') {
    return 'oauth_invalid';
  }
  return null;
}

function relayTerminalFailureCode(
  cause: unknown,
  phase: 'submit' | 'poll' | 'cancel',
): 'oauth_invalid' | 'scope_missing' | 'submission_rejected' | 'unknown_work' | null {
  if (!(cause instanceof RelayControllerError)) return null;
  if (cause.status === 401) return 'oauth_invalid';
  if (cause.status === 403) return 'scope_missing';
  if (phase !== 'submit' && cause.status === 404) return 'unknown_work';
  if (
    phase === 'submit' &&
    (cause.status === 400 || cause.status === 404 || cause.status === 409)
  ) {
    return 'submission_rejected';
  }
  return null;
}

/**
 * Record one ambiguous relay outcome. An owner who still holds access gets a retry; an owner who
 * lost it gets durable cancellation intent, because the relay may already hold accepted work.
 */
async function recordTransientRelayFailure(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
): Promise<typeof agentDelegation.$inferSelect | null> {
  return await db.transaction(async (tx) => {
    const ownership =
      row.status === 'prepared'
        ? and(
            eq(agentDelegation.id, row.id),
            eq(agentDelegation.status, 'prepared'),
            /* v8 ignore next -- @preserve defensive: this path only runs for a row this pass holds a lease token on */
            eq(agentDelegation.submissionLeaseToken, row.submissionLeaseToken ?? ''),
          )
        : and(eq(agentDelegation.id, row.id), eq(agentDelegation.status, 'submitted'));
    const [before] = await tx
      .select({
        cancellationRequestedAt: agentDelegation.cancellationRequestedAt,
        failureCode: agentDelegation.failureCode,
      })
      .from(agentDelegation)
      .where(eq(agentDelegation.id, row.id))
      .for('update')
      .limit(1);
    const ownerCanceled = Boolean(before?.cancellationRequestedAt) && before?.failureCode === null;
    const authorization = await authorizeDelegation(row, tx);
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        ...(ownerCanceled
          ? {}
          : {
              failureCode: authorization.authorized
                ? 'relay_unavailable'
                : authorization.failureCode,
            }),
        ...(authorization.authorized ? {} : { cancellationRequestedAt: now }),
        nextPollAt: authorization.authorized ? new Date(now.getTime() + TRANSIENT_RETRY_MS) : now,
        submissionLeaseToken: null,
        submissionLeaseExpiresAt: null,
      })
      .where(ownership)
      .returning();
    if (!claimed) return null;
    if (claimed.cancellationRequestedAt) return claimed;
    await tx
      .update(agentSession)
      .set({ currentStep: failureMessage('relay_unavailable'), currentStepAt: now })
      .where(eq(agentSession.id, row.sessionId));
    return null;
  });
}

/** What one remote cancellation attempt proved about the work Lovelace Lattice holds. */
interface RemoteCancellation {
  /** Lattice said the work is gone, so Docket may settle. */
  readonly confirmed: boolean;
  /** No later attempt can do better, so retrying would strand the delegation. */
  readonly unreachable: boolean;
  readonly workState: string | null;
  readonly failureCode: string | null;
}

/**
 * Read the grant this delegation's work was submitted under. Status and the enabled switch are
 * deliberately ignored, because a revoked owner still needs their runtime to stop. Identity is
 * not: a connection relinked to another Lovelace account or another runtime can no longer speak
 * for this work, and its answers say nothing about it.
 */
async function connectionForCancellation(
  row: typeof agentDelegation.$inferSelect,
): Promise<typeof latticeConnection.$inferSelect | null> {
  const [connection] = await db
    .select()
    .from(latticeConnection)
    .where(
      and(
        eq(latticeConnection.id, row.connectionId),
        eq(latticeConnection.ownerUserId, row.ownerUserId),
        isNotNull(latticeConnection.accountId),
        row.latticeAccountId
          ? eq(latticeConnection.accountId, row.latticeAccountId)
          : eq(latticeConnection.deviceId, row.runtimeId),
      ),
    )
    .limit(1);
  return connection ?? null;
}

/**
 * Ask Lattice to drop work Docket will never settle. The stable unknown-work answer proves the
 * relay holds nothing, so it confirms cancellation just as a `cancelled` state does.
 */
async function cancelRemoteWork(
  row: typeof agentDelegation.$inferSelect,
  deps: LatticeDelegationDependencies,
): Promise<RemoteCancellation> {
  const connection = await connectionForCancellation(row);
  if (!connection) {
    return {
      confirmed: false,
      unreachable: true,
      workState: row.workState,
      failureCode: 'oauth_invalid',
    };
  }
  try {
    const cancellation = await deps.cancelWork(connection, row.workId);
    if (cancellation.state === 'cancelled') {
      return {
        confirmed: true,
        unreachable: false,
        workState: cancellation.state,
        failureCode: null,
      };
    }
    return {
      confirmed: false,
      unreachable: false,
      workState: row.workState,
      failureCode: 'relay_unavailable',
    };
  } catch (cause) {
    const failureCode =
      authorizationFailureCode(cause) ??
      relayTerminalFailureCode(cause, 'cancel') ??
      'relay_unavailable';
    if (failureCode === 'unknown_work') {
      return { confirmed: true, unreachable: false, workState: row.workState, failureCode: null };
    }
    return { confirmed: false, unreachable: false, workState: row.workState, failureCode };
  }
}

/**
 * Settle one delegation that carries durable cancellation intent, only once Lattice confirms the
 * remote work is gone. A delegation whose `failureCode` is empty was canceled by its owner.
 */
async function settleCancellationIntent(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<'canceled' | 'failed' | 'pending'> {
  const remote = await cancelRemoteWork(row, deps);
  const exhausted = row.deadlineAt
    ? now.getTime() > row.deadlineAt.getTime() + SUBMISSION_DEADLINE_GRACE_MS
    : false;
  if (!remote.confirmed && !remote.unreachable && !exhausted) {
    await db
      .update(agentDelegation)
      .set({ nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_MS) })
      .where(
        and(eq(agentDelegation.id, row.id), isNotNull(agentDelegation.cancellationRequestedAt)),
      );
    return 'pending';
  }
  const settlementCode = row.failureCode;
  if (settlementCode === null) {
    return settledOrPending(
      await settleCanceled(row.id, row.sessionId, remote.workState, now),
      'canceled',
    );
  }
  return settledOrPending(
    await settleFailure(row.id, row.sessionId, settlementCode, remote.workState, now),
    'failed',
  );
}

/**
 * Own the work a relay accepted for a delegation Docket will not run, then have Lattice drop it.
 * The row becomes `submitted` first so a failed cancellation still names live remote work.
 */
async function abandonAcceptedWork(
  row: typeof agentDelegation.$inferSelect,
  acceptedState: string,
  settlementCode: string | null,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<'canceled' | 'failed' | 'skipped'> {
  const abandoned = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        status: 'submitted',
        workState: acceptedState,
        submittedAt: now,
        ...((await ownerAlreadyCanceled(tx, row.id)) ? {} : { failureCode: settlementCode }),
        cancellationRequestedAt: now,
        nextPollAt: now,
        submissionLeaseToken: null,
        submissionLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(agentDelegation.id, row.id),
          eq(agentDelegation.status, 'prepared'),
          /* v8 ignore next -- @preserve defensive: this path only runs for a row this pass holds a lease token on */
          eq(agentDelegation.submissionLeaseToken, row.submissionLeaseToken ?? ''),
        ),
      )
      .returning();
    /* v8 ignore next -- @preserve defensive: the update is fenced by the same predicate that selected this row */
    return claimed ?? null;
  });
  /* v8 ignore next -- @preserve defensive: another pass took this leased row before the compensation could claim it */
  if (!abandoned) return 'skipped';
  const outcome = await settleCancellationIntent(abandoned, now, deps);
  return outcome === 'pending' ? 'skipped' : outcome;
}

/** Record durable cancellation intent on submitted work Docket may no longer settle. */
async function abandonSubmittedWork(
  row: typeof agentDelegation.$inferSelect,
  settlementCode: string,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<'canceled' | 'failed' | 'skipped'> {
  const abandoned = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        /* v8 ignore next -- @preserve defensive: an owner cancellation cannot land between this claim and its own read */
        ...((await ownerAlreadyCanceled(tx, row.id)) ? {} : { failureCode: settlementCode }),
        cancellationRequestedAt: now,
        nextPollAt: now,
      })
      .where(and(eq(agentDelegation.id, row.id), eq(agentDelegation.status, 'submitted')))
      .returning();
    /* v8 ignore next -- @preserve defensive: the update is fenced by the same predicate that selected this row */
    return claimed ?? null;
  });
  /* v8 ignore next -- @preserve defensive: another pass settled this row before the compensation could claim it */
  if (!abandoned) return 'skipped';
  const outcome = await settleCancellationIntent(abandoned, now, deps);
  /* v8 ignore next -- @preserve defensive: a compensation that stays pending is retried by the scheduler */
  return outcome === 'pending' ? 'skipped' : outcome;
}

/**
 * Report whether the owner has already asked to cancel. Their marker is an empty `failureCode`
 * beside recorded intent, and no later authorization code may replace it.
 */
async function ownerAlreadyCanceled(
  tx: LatticeTransaction,
  delegationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({
      cancellationRequestedAt: agentDelegation.cancellationRequestedAt,
      failureCode: agentDelegation.failureCode,
    })
    .from(agentDelegation)
    .where(eq(agentDelegation.id, delegationId))
    .for('update')
    .limit(1);
  return Boolean(row?.cancellationRequestedAt) && row?.failureCode === null;
}

/**
 * What one in-flight submitter still owns. The lease token is the claim: once it is gone the
 * delegation belongs to another pass, and a delegation already settled has no owner at all.
 */
type SubmissionClaim = 'continue' | 'cancel' | 'reassigned' | 'settled';

/** Re-read the claim this submitter believes it holds, so no stale pass writes over a newer one. */
async function submissionClaim(row: typeof agentDelegation.$inferSelect): Promise<SubmissionClaim> {
  const [current] = await db
    .select({
      status: agentDelegation.status,
      cancellationRequestedAt: agentDelegation.cancellationRequestedAt,
      submissionLeaseToken: agentDelegation.submissionLeaseToken,
    })
    .from(agentDelegation)
    .where(eq(agentDelegation.id, row.id))
    .limit(1);
  /* v8 ignore next -- @preserve defensive: the delegation row this submitter holds a lease on always exists */
  if (!current) return 'settled';
  if (current.status !== 'prepared') {
    /* v8 ignore next -- @preserve defensive: a delegation cannot become submitted while this pass holds its lease */
    return current.status === 'submitted' ? 'reassigned' : 'settled';
  }
  if (current.submissionLeaseToken !== row.submissionLeaseToken) return 'reassigned';
  return current.cancellationRequestedAt ? 'cancel' : 'continue';
}

async function claimPreparedSubmission(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
): Promise<typeof agentDelegation.$inferSelect | null> {
  const leaseToken = genId();
  const leaseExpiresAt = row.deadlineAt
    ? new Date(
        Math.max(
          now.getTime() + SUBMISSION_LEASE_MS,
          row.deadlineAt.getTime() + SUBMISSION_DEADLINE_GRACE_MS,
        ),
      )
    : /* v8 ignore next -- @preserve defensive: a prepared row without a deadline never reaches submission */
      new Date(now.getTime() + SUBMISSION_LEASE_MS);
  const [claimed] = await db
    .update(agentDelegation)
    .set({
      submissionLeaseToken: leaseToken,
      submissionLeaseExpiresAt: leaseExpiresAt,
    })
    .where(
      and(
        eq(agentDelegation.id, row.id),
        eq(agentDelegation.status, 'prepared'),
        isNull(agentDelegation.cancellationRequestedAt),
        or(
          isNull(agentDelegation.submissionLeaseExpiresAt),
          lte(agentDelegation.submissionLeaseExpiresAt, now),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function submitPrepared(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<'submitted' | 'failed' | 'canceled' | 'skipped'> {
  const initialAuthorization = await authorizeDelegation(row);
  if (!initialAuthorization.authorized) {
    return (
      await settleFailure(row.id, row.sessionId, initialAuthorization.failureCode, null, now),
      'failed'
    );
  }
  const connection = initialAuthorization.context.connection;
  if (!row.replyKeyCiphertext || !row.deadlineAt) {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'result_key_invalid', null, now),
      'failed',
    );
  }
  if (now >= row.deadlineAt) {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'work_expired', null, now),
      'failed',
    );
  }

  let replyKey: StoredReplyKey;
  try {
    replyKey = loadReplyKey(row.replyKeyCiphertext);
  } catch {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'result_key_invalid', null, now),
      'failed',
    );
  }

  try {
    const runtimes = await deps.listRuntimes(connection);
    const runtime = runtimes.find((candidate) => candidate.latticeId === row.runtimeId);
    if (runtime?.accountId !== connection.accountId) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, 'runtime_not_found', null, now),
        'failed',
      );
    }
    const workKey = usableWorkKey(runtime, now);
    if (!workKey) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, 'runtime_key_expired', null, now),
        'failed',
      );
    }
    const instruction = await promptForSession(row.sessionId);
    const command = deps.buildAgentTaskCommand({
      instruction,
      logicalSubmissionId: row.logicalSubmissionId,
      replyPublicKey: replyKey.publicKey,
      deadlineAt: row.deadlineAt,
      toolPolicy: [],
      executionMode: 'standard',
      model: 'poolside/laguna-s-2.1',
      input: {
        organizationId: row.organizationId,
        taskId: row.taskId,
        assignmentId: row.assignmentId,
      },
      metadata: {
        docketDelegationId: row.id,
        docketSessionId: row.sessionId,
        docketTaskId: row.taskId,
        docketAssignmentId: row.assignmentId,
      },
    });
    const finalAuthorization = await authorizeDelegation(row);
    if (!finalAuthorization.authorized) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, finalAuthorization.failureCode, null, now),
        'failed',
      );
    }
    /* v8 ignore next -- @preserve defensive: the connection account cannot change between two reads in one pass */
    if (runtime.accountId !== finalAuthorization.context.connection.accountId) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, 'oauth_invalid', null, now),
        'failed',
      );
    }
    const beforeSubmit = await submissionClaim(row);
    if (beforeSubmit === 'cancel') {
      return settledAs(await settleCanceled(row.id, row.sessionId, null, now), 'canceled');
    }
    if (beforeSubmit !== 'continue') return 'skipped';
    const accepted = await deps.submitWork(finalAuthorization.context.connection, {
      latticeId: row.runtimeId,
      accountId: finalAuthorization.context.connection.accountId,
      controllerId: `docket:${row.ownerUserId}`,
      logicalSubmissionId: row.logicalSubmissionId,
      workId: row.workId,
      plaintext: new TextEncoder().encode(JSON.stringify(command)),
      deadlineAt: row.deadlineAt.toISOString(),
      keyId: workKey.keyId,
      recipientPublicKey: workKey.publicKey,
    });
    const postSubmitAuthorization = await authorizeDelegation(row);
    if (!postSubmitAuthorization.authorized) {
      return await abandonAcceptedWork(
        row,
        accepted.state,
        postSubmitAuthorization.failureCode,
        now,
        deps,
      );
    }
    /* v8 ignore next -- @preserve defensive: the account cannot change inside the transaction that just read it */
    if (
      postSubmitAuthorization.context.connection.accountId !==
      finalAuthorization.context.connection.accountId
    ) {
      return await abandonAcceptedWork(row, accepted.state, 'oauth_invalid', now, deps);
    }
    const afterSubmit = await submissionClaim(row);
    if (afterSubmit === 'cancel') {
      return await abandonAcceptedWork(row, accepted.state, null, now, deps);
    }
    if (afterSubmit === 'settled') {
      // Nothing owns this accepted work any more, so Lattice must be told to drop it.
      await cancelRemoteWork(row, deps);
      return 'skipped';
    }
    if (afterSubmit === 'reassigned') return 'skipped';
    const runtimeLastSeenAt = accepted.lastSeenAt ?? runtime.lastSeenAt;
    const parsedRuntimeLastSeenAt = runtimeLastSeenAt ? new Date(runtimeLastSeenAt) : null;
    const runtimeMetadata = {
      runtimeName: runtime.displayName,
      runtimeReachability: runtime.reachability ?? null,
      runtimeLastSeenAt:
        parsedRuntimeLastSeenAt && !Number.isNaN(parsedRuntimeLastSeenAt.getTime())
          ? parsedRuntimeLastSeenAt
          : null,
      relayQueuePosition: accepted.queuePosition ?? null,
    };
    if (accepted.state === 'rate_limited' || accepted.state === 'queue_full') {
      const retryAfterMs = accepted.retryAfterMs ?? TRANSIENT_RETRY_MS;
      return await db.transaction(async (tx) => {
        const authorization = await authorizeDelegation(row, tx);
        if (!authorization.authorized) {
          return settledAs(
            await settleFailureInTransaction(
              tx,
              row.id,
              row.sessionId,
              authorization.failureCode,
              null,
              now,
            ),
            'failed',
          );
        }
        /* v8 ignore next -- @preserve defensive: the account cannot change inside the transaction that just read it */
        if (
          authorization.context.connection.accountId !==
          postSubmitAuthorization.context.connection.accountId
        ) {
          return settledAs(
            await settleFailureInTransaction(tx, row.id, row.sessionId, 'oauth_invalid', null, now),
            'failed',
          );
        }
        const [claimed] = await tx
          .update(agentDelegation)
          .set({
            ...runtimeMetadata,
            workState: accepted.state,
            nextPollAt: new Date(now.getTime() + retryAfterMs),
            submissionLeaseToken: null,
            submissionLeaseExpiresAt: null,
          })
          .where(
            and(
              eq(agentDelegation.id, row.id),
              eq(agentDelegation.status, 'prepared'),
              /* v8 ignore next -- @preserve defensive: this path only runs for a row this pass holds a lease token on */
              eq(agentDelegation.submissionLeaseToken, row.submissionLeaseToken ?? ''),
            ),
          )
          .returning({ id: agentDelegation.id });
        /* v8 ignore next -- @preserve defensive: the lease token pins this row to this submitter */
        if (!claimed) return 'skipped';
        await tx
          .update(agentSession)
          .set({
            currentStep:
              accepted.state === 'rate_limited'
                ? 'Waiting for the Lattice submission limit to reset'
                : 'Waiting for space in the selected Lattice runtime queue',
            currentStepAt: now,
          })
          .where(eq(agentSession.id, row.sessionId));
        return 'skipped';
      });
    }
    if (accepted.workId !== row.workId) {
      throw new Error('relay changed the caller-minted work id');
    }
    const acceptedOutcome = await db.transaction(async (tx) => {
      const authorization = await authorizeDelegation(row, tx);
      if (!authorization.authorized) return authorization.failureCode;
      /* v8 ignore next -- @preserve defensive: the account cannot change inside the transaction that just read it */
      if (
        authorization.context.connection.accountId !==
        postSubmitAuthorization.context.connection.accountId
      ) {
        return 'oauth_invalid' as const;
      }
      const [updated] = await tx
        .update(agentDelegation)
        .set({
          ...runtimeMetadata,
          status: 'submitted',
          workState: accepted.state,
          submittedAt: now,
          failureCode: null,
          nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_MS),
          submissionLeaseToken: null,
          submissionLeaseExpiresAt: null,
        })
        .where(
          and(
            eq(agentDelegation.id, row.id),
            eq(agentDelegation.status, 'prepared'),
            /* v8 ignore next -- @preserve defensive: this path only runs for a row this pass holds a lease token on */
            eq(agentDelegation.submissionLeaseToken, row.submissionLeaseToken ?? ''),
          ),
        )
        .returning({ id: agentDelegation.id });
      /* v8 ignore next -- @preserve defensive: the lease token pins this row to this submitter */
      if (!updated) return 'skipped' as const;
      await tx
        .update(agentSession)
        .set({
          status: 'running',
          startedAt: now,
          currentStep:
            accepted.state === 'offline_queued'
              ? 'Queued until the selected Lattice runtime comes online'
              : 'Running on the selected Lattice runtime',
          currentStepAt: now,
        })
        .where(eq(agentSession.id, row.sessionId));
      return 'submitted' as const;
    });
    if (acceptedOutcome === 'submitted' || acceptedOutcome === 'skipped') return acceptedOutcome;
    return await abandonAcceptedWork(row, accepted.state, acceptedOutcome, now, deps);
  } catch (cause) {
    const failureCode =
      authorizationFailureCode(cause) ?? relayTerminalFailureCode(cause, 'submit');
    if (failureCode) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, failureCode, null, now),
        'failed',
      );
    }
    const abandoned = await recordTransientRelayFailure(row, now);
    if (!abandoned) return 'skipped';
    const outcome = await settleCancellationIntent(abandoned, now, deps);
    /* v8 ignore next -- @preserve defensive: a compensation that stays pending is retried by the scheduler */
    return outcome === 'pending' ? 'skipped' : outcome;
  }
}

function progressText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const field of ['text', 'message', 'step'] as const) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

async function persistProgress(
  row: typeof agentDelegation.$inferSelect,
  event: RelayWorkProgressEvent,
  expectedCursor: string,
  payload: unknown,
  workState: RelayWorkState,
  now: Date,
): Promise<'persisted' | 'stale' | 'access_lost' | 'oauth_invalid'> {
  return await db.transaction(async (tx) => {
    const authorization = await authorizeDelegation(row, tx);
    /* v8 ignore next -- @preserve defensive: the account cannot change inside the transaction that just read it */
    if (!authorization.authorized) return authorization.failureCode;
    const [claimed] = await tx
      .update(agentDelegation)
      .set({ relayCursor: event.cursor, workState, failureCode: null })
      .where(
        and(
          eq(agentDelegation.id, row.id),
          eq(agentDelegation.status, 'submitted'),
          eq(agentDelegation.relayCursor, expectedCursor),
        ),
      )
      .returning({ id: agentDelegation.id });
    /* v8 ignore next -- @preserve defensive: a concurrent poll advanced the cursor first */
    if (!claimed) return 'stale';
    const text = progressText(payload);
    if (text) {
      await tx.insert(sessionActivity).values({
        sessionId: row.sessionId,
        organizationId: null,
        type: 'thought',
        body: { text, source: 'lattice', relayCursor: event.cursor },
      });
      await tx
        .update(agentSession)
        .set({ currentStep: text, currentStepAt: now })
        .where(eq(agentSession.id, row.sessionId));
    }
    return 'persisted';
  });
}

interface AuthorizedDelegationContext {
  readonly assignment: typeof athenaAssignment.$inferSelect;
  readonly connection: typeof latticeConnection.$inferSelect;
}

type DelegationAuthorization =
  | { readonly authorized: true; readonly context: AuthorizedDelegationContext }
  | {
      readonly authorized: false;
      readonly failureCode: 'access_lost' | 'oauth_invalid';
    };

async function authorizeDelegation(
  row: typeof agentDelegation.$inferSelect,
  handle: typeof db | LatticeTransaction = db,
): Promise<DelegationAuthorization> {
  const [assignment] = await handle
    .select()
    .from(athenaAssignment)
    .where(
      and(
        eq(athenaAssignment.id, row.assignmentId),
        eq(athenaAssignment.ownerUserId, row.ownerUserId),
        eq(athenaAssignment.organizationId, row.organizationId),
      ),
    )
    .limit(1);
  /* v8 ignore next -- @preserve defensive: the assignment foreign key cascades to this row */
  if (!assignment) return { authorized: false, failureCode: 'access_lost' };
  const [ownerActor] = await handle
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, row.ownerUserId),
        eq(actor.organizationId, row.organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!ownerActor) return { authorized: false, failureCode: 'access_lost' };
  const authorized = (
    await canActor(
      ownerActor.id,
      'contribute',
      { kind: assignment.entityType, id: assignment.entityId, orgId: assignment.organizationId },
      handle,
    )
  ).allow;
  if (!authorized) return { authorized: false, failureCode: 'access_lost' };
  const [connection] = await handle
    .select()
    .from(latticeConnection)
    .where(
      and(
        eq(latticeConnection.id, row.connectionId),
        eq(latticeConnection.ownerUserId, row.ownerUserId),
        eq(latticeConnection.status, 'connected'),
        eq(latticeConnection.enabled, true),
        isNotNull(latticeConnection.accountId),
        eq(latticeConnection.deviceId, row.runtimeId),
      ),
    )
    .limit(1);
  if (!connection?.accountId) return { authorized: false, failureCode: 'oauth_invalid' };
  return {
    authorized: true,
    context: { assignment, connection },
  };
}

function outputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)['outputText'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function proposeResult(
  row: typeof agentDelegation.$inferSelect,
  payload: unknown,
  relayCursor: string,
  now: Date,
): Promise<'proposed' | 'failed' | 'skipped'> {
  const terminalOutcome = { outcome: 'completed', payload } as const;
  const report = outputText(payload);
  if (!report) {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'result_invalid', 'completed', now, {
        terminalOutcome,
        relayCursor,
      }),
      'failed',
    );
  }

  return await db.transaction(async (tx) => {
    const [claimable] = await tx
      .select({ id: agentDelegation.id })
      .from(agentDelegation)
      .where(
        and(
          eq(agentDelegation.id, row.id),
          eq(agentDelegation.status, 'submitted'),
          isNull(agentDelegation.cancellationRequestedAt),
        ),
      )
      .for('update')
      .limit(1);
    /* v8 ignore next -- @preserve defensive: the row is locked for update immediately above */
    if (!claimable) return 'skipped';
    const authorization = await authorizeDelegation(row, tx);
    if (!authorization.authorized) {
      return settledAs(
        await settleFailureInTransaction(
          tx,
          row.id,
          row.sessionId,
          authorization.failureCode,
          'completed',
          now,
          { terminalOutcome, relayCursor },
        ),
        'failed',
      );
    }
    const { assignment, connection } = authorization.context;
    const [activity] = await tx
      .insert(sessionActivity)
      .values({
        sessionId: row.sessionId,
        organizationId: row.organizationId,
        type: 'action',
        approvalStatus: 'proposed',
        proposalGroupId: genId(),
        body: {
          lattice: {
            delegationId: row.id,
            logicalSubmissionId: row.logicalSubmissionId,
            workId: row.workId,
            runtimeId: row.runtimeId,
            runtimeName: connection.deviceName ?? row.runtimeId,
            outcome: 'completed',
          },
          action: {
            kind: 'comment',
            summary: `Post Athena's Lattice result on the assigned ${assignment.entityType}`,
            toolCall: {
              connection: 'docket',
              tool: 'comment',
              input: {
                orgId: row.organizationId,
                subjectType: assignment.entityType,
                subjectId: assignment.entityId,
                body: report,
              },
              toolUseId: `lattice:${row.workId}:result`,
            },
            mode: 'proposal',
          },
        },
      })
      .returning({ id: sessionActivity.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!activity) throw new Error('Lattice proposal insert returned no row');
    const [claimed] = await tx
      .update(agentDelegation)
      .set({
        status: 'proposed',
        workState: 'completed',
        relayCursor,
        nextPollAt: null,
        terminalOutcome,
        failureCode: null,
        returnedActivityId: activity.id,
      })
      .where(
        and(
          eq(agentDelegation.id, row.id),
          eq(agentDelegation.status, 'submitted'),
          isNull(agentDelegation.cancellationRequestedAt),
        ),
      )
      .returning({ id: agentDelegation.id });
    /* v8 ignore next -- @preserve defensive: the row is locked above until this update */
    if (!claimed) throw new Error('Lattice delegation proposal claim returned no row');
    await tx
      .update(agentSession)
      .set({
        status: 'awaiting_approval',
        currentStep: 'Waiting for you to review the Lattice result',
        currentStepAt: now,
      })
      .where(eq(agentSession.id, row.sessionId));
    return 'proposed';
  });
}

async function acknowledgeStoredResult(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<boolean> {
  const initialAuthorization = await authorizeDelegation(row);
  if (!initialAuthorization.authorized) {
    await db
      .update(agentDelegation)
      .set({ nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_MS) })
      .where(and(eq(agentDelegation.id, row.id), isNull(agentDelegation.resultAcknowledgedAt)));
    return false;
  }
  const finalAuthorization = await authorizeDelegation(row);
  /* v8 ignore next -- @preserve defensive: the account cannot change between two reads in the same pass */
  if (
    !finalAuthorization.authorized ||
    finalAuthorization.context.connection.accountId !==
      initialAuthorization.context.connection.accountId
  ) {
    return false;
  }

  try {
    const accepted = await deps.acknowledgeResult(
      finalAuthorization.context.connection,
      row.workId,
    );
    const acknowledgedAt = new Date(accepted.acknowledgedAt);
    /* v8 ignore next -- @preserve defensive: the relay contract returns an ISO time with every acknowledgement */
    if (Number.isNaN(acknowledgedAt.getTime())) {
      throw new Error('relay returned an invalid result acknowledgement time');
    }
    const [updated] = await db
      .update(agentDelegation)
      .set({ resultAcknowledgedAt: acknowledgedAt, nextPollAt: null })
      .where(and(eq(agentDelegation.id, row.id), isNull(agentDelegation.resultAcknowledgedAt)))
      .returning({ id: agentDelegation.id });
    return Boolean(updated);
  } catch {
    await db
      .update(agentDelegation)
      .set({ nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_MS) })
      .where(and(eq(agentDelegation.id, row.id), isNull(agentDelegation.resultAcknowledgedAt)));
    return false;
  }
}

async function pollSubmitted(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<'polled' | 'proposed' | 'failed' | 'canceled' | 'skipped'> {
  const initialAuthorization = await authorizeDelegation(row);
  if (!initialAuthorization.authorized) {
    return await abandonSubmittedWork(row, initialAuthorization.failureCode, now, deps);
  }
  const connection = initialAuthorization.context.connection;
  /* v8 ignore next -- @preserve defensive: the reply-key lifecycle constraint keeps a submitted row keyed */
  if (!row.replyKeyCiphertext) {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'result_key_invalid', row.workState, now),
      'failed',
    );
  }

  let replyKey: StoredReplyKey;
  try {
    replyKey = loadReplyKey(row.replyKeyCiphertext);
  } catch {
    return settledAs(
      await settleFailure(row.id, row.sessionId, 'result_key_invalid', row.workState, now),
      'failed',
    );
  }

  try {
    const finalAuthorization = await authorizeDelegation(row);
    if (!finalAuthorization.authorized) {
      return await abandonSubmittedWork(row, finalAuthorization.failureCode, now, deps);
    }
    /* v8 ignore next -- @preserve defensive: the account cannot change between two reads in one pass */
    if (finalAuthorization.context.connection.accountId !== connection.accountId) {
      return await abandonSubmittedWork(row, 'oauth_invalid', now, deps);
    }
    const response = await deps.pollEvents(
      finalAuthorization.context.connection,
      row.workId,
      row.relayCursor,
    );
    if (response.workId !== row.workId) {
      return settledAs(
        await settleFailure(row.id, row.sessionId, 'unknown_work', row.workState, now),
        'failed',
      );
    }
    let expectedCursor = row.relayCursor;
    for (const progress of response.events.filter(
      (event): event is RelayWorkProgressEvent => event.kind === 'progress',
    )) {
      if (progress.cursor === expectedCursor) continue;
      let payload: unknown;
      try {
        payload = await deps.openWork(progress.sealed, replyKey.privateKey, {
          latticeId: row.runtimeId,
          workId: row.workId,
        });
      } catch {
        return settledAs(
          await settleFailure(
            row.id,
            row.sessionId,
            'result_decryption_failed',
            response.state,
            now,
            { retainReplyKey: true },
          ),
          'failed',
        );
      }
      const persistence = await persistProgress(
        row,
        progress,
        expectedCursor,
        payload,
        response.state,
        now,
      );
      if (persistence === 'access_lost' || persistence === 'oauth_invalid') {
        return await abandonSubmittedWork(row, persistence, now, deps);
      }
      /* v8 ignore next -- @preserve defensive: a concurrent poll advanced the cursor first */
      if (persistence === 'stale') {
        return 'skipped';
      }
      expectedCursor = progress.cursor;
    }
    const terminal = response.events.find(
      (event): event is RelayWorkResultEvent | RelayWorkExpiryEvent => event.kind !== 'progress',
    );
    if (!terminal) {
      const postPollAuthorization = await authorizeDelegation(row);
      if (!postPollAuthorization.authorized) {
        return await abandonSubmittedWork(row, postPollAuthorization.failureCode, now, deps);
      }
      const unauthorized = await db.transaction(async (tx) => {
        const authorization = await authorizeDelegation(row, tx);
        if (!authorization.authorized) return authorization.failureCode;
        await tx
          .update(agentDelegation)
          .set({
            workState: response.state,
            relayCursor: expectedCursor,
            failureCode: null,
            nextPollAt: new Date(now.getTime() + response.nextPollAfterMs),
          })
          .where(
            and(
              eq(agentDelegation.id, row.id),
              eq(agentDelegation.status, 'submitted'),
              eq(agentDelegation.relayCursor, expectedCursor),
            ),
          );
        return null;
      });
      if (unauthorized) return await abandonSubmittedWork(row, unauthorized, now, deps);
      return 'polled';
    }
    if (terminal.kind === 'expiry') {
      return settledAs(
        await settleFailure(row.id, row.sessionId, 'work_expired', response.state, now, {
          terminalOutcome: { outcome: 'expired', payload: terminal },
          relayCursor: terminal.cursor,
        }),
        'failed',
      );
    }
    let payload: unknown;
    try {
      payload = await deps.openWork(terminal.sealed, replyKey.privateKey, {
        latticeId: row.runtimeId,
        workId: row.workId,
      });
    } catch {
      return settledAs(
        await settleFailure(
          row.id,
          row.sessionId,
          'result_decryption_failed',
          response.state,
          now,
          { retainReplyKey: true, relayCursor: terminal.cursor },
        ),
        'failed',
      );
    }
    if (terminal.outcome === 'completed') {
      return await proposeResult(row, payload, terminal.cursor, now);
    }
    if (terminal.outcome === 'cancelled') {
      return settledAs(
        await settleCanceled(
          row.id,
          row.sessionId,
          response.state,
          now,
          { outcome: terminal.outcome, payload },
          terminal.cursor,
        ),
        'canceled',
      );
    }
    const code =
      terminal.outcome === 'work_key_expired' ? 'runtime_key_expired' : 'execution_failed';
    return settledAs(
      await settleFailure(row.id, row.sessionId, code, response.state, now, {
        terminalOutcome: { outcome: terminal.outcome, payload },
        relayCursor: terminal.cursor,
      }),
      'failed',
    );
  } catch (cause) {
    const failureCode = authorizationFailureCode(cause) ?? relayTerminalFailureCode(cause, 'poll');
    if (failureCode === 'unknown_work') {
      return settledAs(
        await settleFailure(row.id, row.sessionId, failureCode, row.workState, now),
        'failed',
      );
    }
    if (failureCode) {
      return await abandonSubmittedWork(row, failureCode, now, deps);
    }
    const abandoned = await recordTransientRelayFailure(row, now);
    if (!abandoned) return 'skipped';
    const outcome = await settleCancellationIntent(abandoned, now, deps);
    /* v8 ignore next -- @preserve defensive: a compensation that stays pending is retried by the scheduler */
    return outcome === 'pending' ? 'skipped' : outcome;
  }
}

/** Poll due work first, settle terminal output, then submit a bounded prepared batch. */
export async function sweepLatticeDelegations(
  now: Date,
  deps: LatticeDelegationDependencies,
  options: LatticeDelegationSweepOptions,
): Promise<LatticeDelegationSweepResult> {
  const runtimeOptions = options as LatticeDelegationSweepOptions | null | undefined;
  if (
    runtimeOptions == null ||
    typeof runtimeOptions.pollingEnabled !== 'boolean' ||
    typeof runtimeOptions.submissionsEnabled !== 'boolean'
  ) {
    throw new Error('Lattice scheduler controls are required');
  }
  const result = {
    polled: 0,
    submitted: 0,
    proposed: 0,
    failed: 0,
    canceled: 0,
    acknowledged: 0,
  };
  if (runtimeOptions.pollingEnabled) {
    await reconcileDecidedProposals(now);
    const canceling = await db
      .select()
      .from(agentDelegation)
      .where(
        and(
          isNotNull(agentDelegation.cancellationRequestedAt),
          or(eq(agentDelegation.status, 'prepared'), eq(agentDelegation.status, 'submitted')),
          or(
            isNull(agentDelegation.submissionLeaseExpiresAt),
            lte(agentDelegation.submissionLeaseExpiresAt, now),
          ),
          or(isNull(agentDelegation.nextPollAt), lte(agentDelegation.nextPollAt, now)),
        ),
      )
      .orderBy(asc(agentDelegation.nextPollAt), asc(agentDelegation.createdAt))
      .limit(MAX_POLL_BATCH);
    for (const row of canceling) {
      const outcome = await settleCancellationIntent(row, now, deps);
      if (outcome === 'canceled') result.canceled += 1;
      if (outcome === 'failed') result.failed += 1;
    }

    const due = await db
      .select()
      .from(agentDelegation)
      .where(
        and(
          eq(agentDelegation.status, 'submitted'),
          isNull(agentDelegation.cancellationRequestedAt),
          or(isNull(agentDelegation.nextPollAt), lte(agentDelegation.nextPollAt, now)),
        ),
      )
      .orderBy(asc(agentDelegation.nextPollAt), asc(agentDelegation.createdAt))
      .limit(MAX_POLL_BATCH);
    for (const row of due) {
      const outcome = await pollSubmitted(row, now, deps);
      if (
        outcome === 'polled' ||
        outcome === 'proposed' ||
        outcome === 'failed' ||
        outcome === 'canceled'
      ) {
        result.polled += 1;
      }
      if (outcome === 'proposed') result.proposed += 1;
      if (outcome === 'failed') result.failed += 1;
      if (outcome === 'canceled') result.canceled += 1;
    }

    const awaitingAcknowledgement = await db
      .select()
      .from(agentDelegation)
      .where(
        and(
          or(
            eq(agentDelegation.status, 'completed'),
            eq(agentDelegation.status, 'failed'),
            eq(agentDelegation.status, 'canceled'),
          ),
          isNotNull(agentDelegation.terminalOutcome),
          isNull(agentDelegation.resultAcknowledgedAt),
          or(isNull(agentDelegation.nextPollAt), lte(agentDelegation.nextPollAt, now)),
        ),
      )
      .orderBy(asc(agentDelegation.nextPollAt), asc(agentDelegation.createdAt))
      .limit(MAX_POLL_BATCH);
    for (const row of awaitingAcknowledgement) {
      if (await acknowledgeStoredResult(row, now, deps)) result.acknowledged += 1;
    }
  }

  if (!runtimeOptions.submissionsEnabled) return result;
  const prepared = await db
    .select()
    .from(agentDelegation)
    .where(
      and(
        eq(agentDelegation.status, 'prepared'),
        isNull(agentDelegation.cancellationRequestedAt),
        or(isNull(agentDelegation.nextPollAt), lte(agentDelegation.nextPollAt, now)),
      ),
    )
    .orderBy(asc(agentDelegation.nextPollAt), asc(agentDelegation.createdAt))
    .limit(MAX_SUBMIT_BATCH);
  for (const row of prepared) {
    const claimed = await claimPreparedSubmission(row, now);
    if (!claimed) continue;
    const outcome = await submitPrepared(claimed, now, deps);
    if (outcome === 'submitted') result.submitted += 1;
    if (outcome === 'failed') result.failed += 1;
    if (outcome === 'canceled') result.canceled += 1;
  }
  return result;
}

/**
 * Leave a delegation whose submit is already in flight to the scheduler pass that holds its lease.
 * Recording intent keeps the reply key, work id, and lease intact so that submitter can compensate.
 */
async function deferCancellationToSubmitter(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
): Promise<boolean> {
  if (row.status !== 'prepared') return false;
  const [deferred] = await db
    .update(agentDelegation)
    .set({ cancellationRequestedAt: now, failureCode: null })
    .where(
      and(
        eq(agentDelegation.id, row.id),
        eq(agentDelegation.status, 'prepared'),
        isNotNull(agentDelegation.submissionLeaseToken),
      ),
    )
    .returning({ id: agentDelegation.id });
  return Boolean(deferred);
}

/**
 * Hand one delegation to the scheduler's cancellation pass. The owner's request is durable from
 * this moment, so the caller may report the cancellation as accepted while Lattice is still being
 * asked to drop the work.
 */
async function recordOwnerCancellationIntent(
  row: typeof agentDelegation.$inferSelect,
  now: Date,
): Promise<boolean> {
  const [recorded] = await db
    .update(agentDelegation)
    .set({
      cancellationRequestedAt: now,
      failureCode: null,
      nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_MS),
    })
    .where(
      and(
        eq(agentDelegation.id, row.id),
        or(eq(agentDelegation.status, 'prepared'), eq(agentDelegation.status, 'submitted')),
      ),
    )
    .returning({ id: agentDelegation.id });
  return Boolean(recorded);
}

/** Cancel one owner-matched Lattice delegation before the Docket session is settled locally. */
export async function cancelLatticeDelegation(
  ownerUserId: string,
  sessionId: string,
  now: Date,
  deps: LatticeDelegationDependencies,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(agentDelegation)
    .where(
      and(
        eq(agentDelegation.ownerUserId, ownerUserId),
        eq(agentDelegation.sessionId, sessionId),
        or(
          eq(agentDelegation.status, 'prepared'),
          eq(agentDelegation.status, 'submitted'),
          eq(agentDelegation.status, 'proposed'),
        ),
      ),
    )
    .limit(1);
  if (!row) return false;
  if (await deferCancellationToSubmitter(row, now)) return true;

  let remoteFailureCode: string | null = null;
  let remoteWorkState = row.workState;
  // A prepared row whose relay call ended ambiguously may still be holding accepted work.
  if (row.status === 'submitted' || row.failureCode !== null) {
    const remote = await cancelRemoteWork(row, deps);
    // Live remote work outlives an unconfirmed cancellation, so the scheduler must keep asking.
    if (!remote.confirmed && !remote.unreachable) {
      return await recordOwnerCancellationIntent(row, now);
    }
    remoteFailureCode = remote.failureCode;
    if (remote.confirmed) remoteWorkState = remote.workState;
  }

  const settled = await db.transaction(async (tx) => {
    const [canceled] = await tx
      .update(agentDelegation)
      .set({
        status: 'canceled',
        workState: remoteFailureCode ? row.workState : remoteWorkState,
        failureCode: remoteFailureCode,
        replyKeyCiphertext: null,
        returnedActivityId: null,
        submissionLeaseToken: null,
        submissionLeaseExpiresAt: null,
        cancellationRequestedAt: null,
        nextPollAt: null,
        settledAt: now,
      })
      .where(
        and(
          eq(agentDelegation.id, row.id),
          eq(agentDelegation.status, row.status),
          isNull(agentDelegation.cancellationRequestedAt),
          row.status === 'prepared' ? isNull(agentDelegation.submissionLeaseToken) : undefined,
        ),
      )
      .returning({ id: agentDelegation.id });
    /* v8 ignore next -- @preserve defensive: a row that moved on is handed to the scheduler by the caller */
    if (!canceled) return false;
    if (row.returnedActivityId) {
      await tx
        .update(sessionActivity)
        .set({ approvalStatus: 'rejected' })
        .where(
          and(
            eq(sessionActivity.id, row.returnedActivityId),
            eq(sessionActivity.approvalStatus, 'proposed'),
          ),
        );
    }
    await tx
      .update(agentSession)
      .set({
        status: 'canceled',
        currentStep: remoteFailureCode
          ? 'Docket canceled this session, but Lattice could not confirm remote cancellation.'
          : 'The Lattice assignment was canceled',
        currentStepAt: now,
        endedAt: now,
        interruptedAt: now,
      })
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.ownerUserId, ownerUserId)));
    return true;
  });
  // The delegation moved between the read and the settlement, so the scheduler owns it now.
  /* v8 ignore next -- @preserve defensive: the settlement above claims the row this pass just read */
  return settled ? true : await recordOwnerCancellationIntent(row, now);
}
