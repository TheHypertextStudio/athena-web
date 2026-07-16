/**
 * Durable execution-generation claims for agent sessions.
 *
 * @remarks
 * Each session has at most one fresh `running` generation. The claim transaction is short: it
 * locks only the persisted session (and, for Athena, its owner row), enforces the owner's active
 * run ceiling, and commits before any provider or MCP work begins. Lease tokens fence recovered
 * workers so an expired process cannot resume writing after another worker takes over.
 */
import { agentSession, agentSessionRun, db, genId, user } from '@docket/db';
import { and, count, desc, eq, gt, lte, or } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';
import { env } from '../env';
import type { SessionRow } from '../routes/agent-session-helpers';

/** Product default for simultaneously running personal Athena generations. */
export const DEFAULT_ATHENA_CONCURRENCY = 8;
/** A healthy worker renews well before this default lease expires. */
export const DEFAULT_RUN_LEASE_MS = 60_000;
/** Default cadence for extending a healthy generation lease. */
export const DEFAULT_RUN_HEARTBEAT_MS = 20_000;

/** A fenced claim on one durable execution generation. */
export interface RunGenerationLease {
  readonly runId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly leaseDurationMs: number;
}

/** Opaque execution identity allowed to cross the Docket/Cloudflare boundary. */
export interface RunGenerationMessage {
  readonly sessionId: string;
  readonly generation: number;
  readonly workflowId: string;
}

/** Persisted queue admission returned before any Cloudflare side effect. */
export interface QueuedRunGeneration {
  readonly runId: string;
  readonly message: RunGenerationMessage;
}

/** Exact queued generation claimed by a Cloudflare Workflow callback. */
export interface ClaimedQueuedRunGeneration {
  readonly session: SessionRow;
  readonly lease: RunGenerationLease;
}

/** Testable timing inputs for a generation claim. */
export interface RunGenerationOptions {
  readonly now?: Date;
  readonly leaseDurationMs?: number;
  /** Keep a partially-approved session parked while executing only the selected actions. */
  readonly resumeSession?: boolean;
  /** Session states this specific execution entry point may claim atomically. */
  readonly runnableStatuses?: readonly SessionRow['status'][];
  /** Clear a prior terminal timestamp only after admission succeeds. */
  readonly clearEndedAt?: boolean;
}

/** Transaction handle supplied after a generation lease has been locked and revalidated. */
export type RunGenerationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A persisted effect committed only while the caller owns the locked generation lease. */
export type RunGenerationEffect<T> = (tx: RunGenerationTransaction) => Promise<T>;

/** Return the Athena owner after checking the persisted executor shape. */
function ownerOf(session: SessionRow): string {
  if (session.executorKind !== 'athena' || !session.ownerUserId) {
    throw new Error('Athena session is missing its owner');
  }
  return session.ownerUserId;
}

/** Compute the exclusive expiry timestamp for a lease claim or renewal. */
function expiresAt(now: Date, leaseDurationMs: number): Date {
  return new Date(now.getTime() + leaseDurationMs);
}

function messageOf(run: typeof agentSessionRun.$inferSelect): RunGenerationMessage {
  return {
    sessionId: run.sessionId,
    generation: run.generation,
    workflowId: run.workflowInstanceId,
  };
}

/**
 * Persist the next deterministic generation before dispatching it to Cloudflare.
 *
 * @remarks
 * Repeating admission while the latest row is still queued returns that same row, so a failed
 * HTTP dispatch can safely be retried without creating a second generation. The owner ceiling
 * includes queued work as well as fresh running leases.
 */
export async function enqueueRunGeneration(
  session: SessionRow,
  options: RunGenerationOptions = {},
): Promise<QueuedRunGeneration> {
  const now = options.now ?? new Date();
  const resumeSession = options.resumeSession ?? true;
  const runnableStatuses = options.runnableStatuses ?? (['pending', 'running'] as const);

  return db.transaction(async (tx) => {
    if (session.executorKind === 'athena') {
      const [owner] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, ownerOf(session)))
        .for('update');
      if (!owner) throw new NotFoundError('Athena owner not found');
    }

    const [current] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, session.id))
      .for('update');
    if (!current) throw new NotFoundError('Session not found');
    if (current.executorKind !== session.executorKind) {
      throw new ConflictError('Session executor changed during admission');
    }
    if (!runnableStatuses.includes(current.status)) {
      throw new ConflictError('Session is not in a runnable state');
    }

    const [latest] = await tx
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, current.id))
      .orderBy(desc(agentSessionRun.generation))
      .limit(1);
    if (latest?.status === 'queued') {
      return { runId: latest.id, message: messageOf(latest) };
    }
    if (
      latest?.status === 'running' &&
      latest.leaseExpiresAt !== null &&
      latest.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new ConflictError('Session generation is already running');
    }

    if (current.executorKind === 'athena') {
      const ownerUserId = current.ownerUserId;
      if (!ownerUserId) throw new Error('Athena session is missing its owner');
      const [active] = await tx
        .select({ value: count() })
        .from(agentSessionRun)
        .where(
          and(
            eq(agentSessionRun.ownerUserId, ownerUserId),
            or(
              eq(agentSessionRun.status, 'queued'),
              and(eq(agentSessionRun.status, 'running'), gt(agentSessionRun.leaseExpiresAt, now)),
            ),
          ),
        );
      const limit = env.ATHENA_MAX_CONCURRENT_RUNS ?? DEFAULT_ATHENA_CONCURRENCY;
      if ((active?.value ?? 0) >= limit) {
        throw new ConflictError('Athena has reached the concurrent run limit');
      }
    }

    const generation = (latest?.generation ?? 0) + 1;
    const [queued] = await tx
      .insert(agentSessionRun)
      .values({
        sessionId: current.id,
        organizationId: current.executorKind === 'registered_agent' ? current.organizationId : null,
        ownerUserId: current.executorKind === 'athena' ? current.ownerUserId : null,
        generation,
        workflowInstanceId: `${current.id}:${String(generation)}`,
        status: 'queued',
      })
      .returning();
    if (!queued) throw new Error('queued run generation insert returned no row');

    if (resumeSession) {
      await tx
        .update(agentSession)
        .set({
          status: 'running',
          startedAt: current.startedAt ?? now,
          ...(options.clearEndedAt ? { endedAt: null } : {}),
        })
        .where(eq(agentSession.id, current.id));
    }
    return { runId: queued.id, message: messageOf(queued) };
  });
}

/** Claim the exact queued generation named by an authenticated Workflow callback. */
export async function claimQueuedRunGeneration(
  message: RunGenerationMessage,
  options: Pick<RunGenerationOptions, 'now' | 'leaseDurationMs'> = {},
): Promise<ClaimedQueuedRunGeneration> {
  const now = options.now ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_RUN_LEASE_MS;
  const token = genId();

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, message.sessionId))
      .for('update');
    if (!current) throw new NotFoundError('Session not found');
    if (current.executorKind === 'athena') {
      const ownerUserId = current.ownerUserId;
      if (!ownerUserId) throw new Error('Athena session is missing its owner');
      const [owner] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, ownerUserId))
        .for('update');
      if (!owner) throw new NotFoundError('Athena owner not found');
    }

    const [run] = await tx
      .select()
      .from(agentSessionRun)
      .where(
        and(
          eq(agentSessionRun.sessionId, message.sessionId),
          eq(agentSessionRun.generation, message.generation),
          eq(agentSessionRun.workflowInstanceId, message.workflowId),
        ),
      )
      .for('update');
    const recoveringExpired =
      run?.status === 'running' &&
      run.leaseExpiresAt !== null &&
      run.leaseExpiresAt.getTime() <= now.getTime();
    if (run?.status !== 'queued' && !recoveringExpired) {
      throw new ConflictError('Queued session generation is unavailable');
    }

    const [claimed] = await tx
      .update(agentSessionRun)
      .set({
        status: 'running',
        attempt: run.attempt + 1,
        leaseToken: token,
        leaseExpiresAt: expiresAt(now, leaseDurationMs),
        lastError: null,
        startedAt: run.startedAt ?? now,
      })
      .where(
        and(
          eq(agentSessionRun.id, run.id),
          recoveringExpired
            ? and(eq(agentSessionRun.status, 'running'), lte(agentSessionRun.leaseExpiresAt, now))
            : eq(agentSessionRun.status, 'queued'),
        ),
      )
      .returning({ id: agentSessionRun.id });
    if (!claimed) throw new ConflictError('Queued session generation changed during claim');

    return {
      session: current,
      lease: {
        runId: run.id,
        sessionId: current.id,
        generation: run.generation,
        leaseToken: token,
        leaseDurationMs,
      },
    };
  });
}

/**
 * Claim or recover the runnable generation for a session.
 *
 * @remarks
 * A fresh running generation rejects duplicate callers. An expired generation is recovered in
 * place with an incremented attempt and a new fencing token. Otherwise a new deterministic
 * `sessionId:generation` record is inserted. Athena owner admission is enforced in the same
 * transaction; registered agents retain compatibility without a per-user ceiling.
 */
export async function claimRunGeneration(
  session: SessionRow,
  options: RunGenerationOptions = {},
): Promise<RunGenerationLease> {
  const now = options.now ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_RUN_LEASE_MS;
  const resumeSession = options.resumeSession ?? true;
  const runnableStatuses =
    options.runnableStatuses ??
    (resumeSession
      ? (['pending', 'running'] as const)
      : (['pending', 'running', 'awaiting_approval'] as const));
  const token = genId();

  return db.transaction(async (tx) => {
    if (session.executorKind === 'athena') {
      const [owner] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, ownerOf(session)))
        .for('update');
      if (!owner) throw new NotFoundError('Athena owner not found');
    }

    const [current] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, session.id))
      .for('update');
    if (!current) throw new NotFoundError('Session not found');
    if (current.executorKind !== session.executorKind) {
      throw new ConflictError('Session executor changed during admission');
    }
    if (!runnableStatuses.includes(current.status)) {
      throw new ConflictError('Session is not in a runnable state');
    }

    const [latest] = await tx
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, current.id))
      .orderBy(desc(agentSessionRun.generation))
      .limit(1);
    if (
      latest?.status === 'running' &&
      latest.leaseExpiresAt !== null &&
      latest.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new ConflictError('Session generation is already running');
    }

    if (current.executorKind === 'athena') {
      const ownerUserId = current.ownerUserId;
      if (!ownerUserId) throw new Error('Athena session is missing its owner');
      const [active] = await tx
        .select({ value: count() })
        .from(agentSessionRun)
        .where(
          and(
            eq(agentSessionRun.ownerUserId, ownerUserId),
            eq(agentSessionRun.status, 'running'),
            gt(agentSessionRun.leaseExpiresAt, now),
          ),
        );
      const limit = env.ATHENA_MAX_CONCURRENT_RUNS ?? DEFAULT_ATHENA_CONCURRENCY;
      if ((active?.value ?? 0) >= limit) {
        throw new ConflictError('Athena has reached the concurrent run limit');
      }
    }

    let claimed: typeof agentSessionRun.$inferSelect | undefined;
    if (latest?.status === 'running') {
      [claimed] = await tx
        .update(agentSessionRun)
        .set({
          attempt: latest.attempt + 1,
          leaseToken: token,
          leaseExpiresAt: expiresAt(now, leaseDurationMs),
          lastError: null,
        })
        .where(
          and(
            eq(agentSessionRun.id, latest.id),
            eq(agentSessionRun.status, 'running'),
            lte(agentSessionRun.leaseExpiresAt, now),
          ),
        )
        .returning();
      if (!claimed) throw new ConflictError('Session generation changed during recovery');
    } else {
      const generation = (latest?.generation ?? 0) + 1;
      [claimed] = await tx
        .insert(agentSessionRun)
        .values({
          sessionId: current.id,
          organizationId:
            current.executorKind === 'registered_agent' ? current.organizationId : null,
          ownerUserId: current.executorKind === 'athena' ? current.ownerUserId : null,
          generation,
          workflowInstanceId: `${current.id}:${String(generation)}`,
          status: 'running',
          attempt: 1,
          leaseToken: token,
          leaseExpiresAt: expiresAt(now, leaseDurationMs),
          startedAt: now,
        })
        .returning();
    }

    if (resumeSession) {
      await tx
        .update(agentSession)
        .set({
          status: 'running',
          startedAt: current.startedAt ?? now,
          ...(options.clearEndedAt ? { endedAt: null } : {}),
        })
        .where(eq(agentSession.id, current.id));
    }

    if (!claimed) throw new Error('run generation claim returned no row');

    return {
      runId: claimed.id,
      sessionId: current.id,
      generation: claimed.generation,
      leaseToken: token,
      leaseDurationMs,
    };
  });
}

/** Renew a generation only while this worker still owns its fencing token. */
export async function renewRunGeneration(
  lease: RunGenerationLease,
  now = new Date(),
): Promise<void> {
  const [renewed] = await db
    .update(agentSessionRun)
    .set({ leaseExpiresAt: expiresAt(now, lease.leaseDurationMs) })
    .where(
      and(
        eq(agentSessionRun.id, lease.runId),
        eq(agentSessionRun.status, 'running'),
        eq(agentSessionRun.leaseToken, lease.leaseToken),
      ),
    )
    .returning({ id: agentSessionRun.id });
  if (!renewed) throw new ConflictError('Session generation lease was lost');
}

/** Assert this worker still owns a fresh generation before persistence or tool dispatch. */
export async function assertRunGeneration(
  lease: RunGenerationLease,
  now = new Date(),
): Promise<void> {
  const [owned] = await db
    .select({ id: agentSessionRun.id })
    .from(agentSessionRun)
    .where(
      and(
        eq(agentSessionRun.id, lease.runId),
        eq(agentSessionRun.status, 'running'),
        eq(agentSessionRun.leaseToken, lease.leaseToken),
        gt(agentSessionRun.leaseExpiresAt, now),
      ),
    )
    .limit(1);
  if (!owned) throw new ConflictError('Session generation lease was lost');
}

/**
 * Commit a generation-owned persisted effect behind the lease fence.
 *
 * @remarks
 * The matching run row is locked and checked inside the same database transaction as the effect.
 * A takeover can therefore happen either before the lock (the stale worker writes nothing) or
 * after commit (the completed effect belongs to the still-current worker), never between the
 * ownership check and effect commit.
 *
 * @param lease - The generation ownership token to lock and revalidate.
 * @param effect - The writes to commit while the matching run row remains locked.
 * @param now - Testable freshness boundary for the lease.
 * @returns The effect result after the transaction commits.
 */
export async function withRunGenerationFence<T>(
  lease: RunGenerationLease,
  effect: RunGenerationEffect<T>,
  now = new Date(),
): Promise<T> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: agentSessionRun.id })
      .from(agentSessionRun)
      .where(
        and(
          eq(agentSessionRun.id, lease.runId),
          eq(agentSessionRun.status, 'running'),
          eq(agentSessionRun.leaseToken, lease.leaseToken),
          gt(agentSessionRun.leaseExpiresAt, now),
        ),
      )
      .for('update');
    if (!owned) throw new ConflictError('Session generation lease was lost');
    return effect(tx);
  });
}

/** Complete one checkpoint generation without changing the parent session. */
export async function checkpointRunGeneration(lease: RunGenerationLease): Promise<void> {
  const now = new Date();
  const [completed] = await db
    .update(agentSessionRun)
    .set({
      status: 'completed',
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(agentSessionRun.id, lease.runId),
        eq(agentSessionRun.status, 'running'),
        eq(agentSessionRun.leaseToken, lease.leaseToken),
        gt(agentSessionRun.leaseExpiresAt, now),
      ),
    )
    .returning({ id: agentSessionRun.id });
  if (!completed) throw new ConflictError('Session generation lease was lost');
}

/**
 * Atomically settle the owned generation and its parent session.
 */
export async function settleRunGeneration(
  lease: RunGenerationLease,
  sessionStatus: 'awaiting_input' | 'awaiting_approval' | 'completed' | 'failed' | 'canceled',
  lastError?: string,
  effect?: RunGenerationEffect<void>,
): Promise<SessionRow> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const runStatus =
      sessionStatus === 'completed'
        ? 'completed'
        : sessionStatus === 'failed'
          ? 'failed'
          : sessionStatus === 'canceled'
            ? 'canceled'
            : 'waiting';
    const [completed] = await tx
      .update(agentSessionRun)
      .set({
        status: runStatus,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        ...(lastError ? { lastError } : {}),
      })
      .where(
        and(
          eq(agentSessionRun.id, lease.runId),
          eq(agentSessionRun.status, 'running'),
          eq(agentSessionRun.leaseToken, lease.leaseToken),
          gt(agentSessionRun.leaseExpiresAt, now),
        ),
      )
      .returning({ id: agentSessionRun.id });
    if (!completed) throw new ConflictError('Session generation lease was lost');

    await effect?.(tx);

    const terminal =
      sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'canceled';
    const [settled] = await tx
      .update(agentSession)
      .set({ status: sessionStatus, ...(terminal ? { endedAt: new Date() } : {}) })
      .where(eq(agentSession.id, lease.sessionId))
      .returning();
    if (!settled) throw new Error('session update returned no row');
    return settled;
  });
}

/** A renewable heartbeat whose failure is surfaced before the next side effect. */
export interface RunGenerationHeartbeat {
  readonly assertActive: () => Promise<void>;
  readonly stop: () => void;
}

/** Start renewing a healthy generation until explicitly stopped. */
export function startRunGenerationHeartbeat(
  lease: RunGenerationLease,
  intervalMs = DEFAULT_RUN_HEARTBEAT_MS,
): RunGenerationHeartbeat {
  let pending: Promise<void> = Promise.resolve();
  let failure: unknown;
  const timer = setInterval(() => {
    pending = pending
      .then(() => renewRunGeneration(lease))
      .catch((error: unknown) => {
        failure = error;
      });
  }, intervalMs);

  return {
    async assertActive(): Promise<void> {
      await pending;
      if (failure) {
        throw failure instanceof Error ? failure : new Error('Session generation heartbeat failed');
      }
      await assertRunGeneration(lease);
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
