/** Docket-side admission, durable outbox, and signed dispatch for Athena generations. */
import { agentSession, agentSessionDispatch, agentSessionRun, db, genId } from '@docket/db';
import type { AgentSessionDispatchAction } from '@docket/db';
import { and, asc, desc, eq, lte, or } from 'drizzle-orm';

import { ApiError, ConflictError } from '../error';
import { env } from '../env';
import type { SessionRow } from '../routes/agent-session-helpers';
import { signInternalRequest } from './execution-hmac';
import {
  enqueueRunGeneration,
  type QueuedRunGeneration,
  type RunGenerationMessage,
  type RunGenerationOptions,
  type RunGenerationTransaction,
} from './run-generation';

/** Maximum delivery attempts before an intent requires operator attention. */
export const MAX_DISPATCH_ATTEMPTS = 8;
/** Short claim lease so a crashed dispatcher becomes recoverable promptly. */
export const DEFAULT_DISPATCH_LEASE_MS = 30_000;
/** Bounded default sweep size for one scheduled invocation. */
export const DEFAULT_DISPATCH_SWEEP_SIZE = 25;
/** Age after which a delivered intent is replayed if Docket still needs the same effect. */
export const DEFAULT_DISPATCH_RECONCILIATION_MS = 20 * 60_000;
/** Deadline for one API-to-Worker request. */
export const DEFAULT_RUNNER_REQUEST_TIMEOUT_MS = 10_000;

/** Minimal config needed to choose and authenticate the execution path. */
export interface AsyncRunnerConfig {
  readonly APP_MODE?: 'local' | 'test' | 'production';
  readonly ATHENA_ASYNC_RUNNER_ENABLED?: boolean;
  readonly CLOUDFLARE_ATHENA_RUNNER_URL?: string;
  readonly DOCKET_TO_CLOUDFLARE_HMAC_SECRET?: string;
}

/** Transport needed after Docket has conditionally claimed a persisted intent. */
export interface AsyncDispatchDependencies {
  readonly config: AsyncRunnerConfig;
  readonly fetch: (input: URL, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

/** Injectable effects for deterministic admission tests. */
export interface AsyncRunnerDependencies extends AsyncDispatchDependencies {
  readonly enqueue: typeof enqueueRunGeneration;
}

/** Synchronous fallback or accepted asynchronous generation. */
export type AthenaGenerationAdmission =
  | { readonly mode: 'sync' }
  | { readonly mode: 'async'; readonly queued: QueuedRunGeneration };

/** Inputs controlling one bounded recovery pass. */
export interface DispatchSweepOptions {
  readonly now?: Date;
  readonly clock?: () => Date;
  readonly batchSize?: number;
  readonly leaseDurationMs?: number;
}

/** Counts safe to expose from the protected recovery route. */
export interface DispatchSweepResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly failed: number;
}

interface ClaimedDispatch {
  readonly id: string;
  readonly runId: string;
  readonly action: AgentSessionDispatchAction;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly message: RunGenerationMessage;
}

type DeliveryResult = 'delivered' | 'retried' | 'failed';
type DispatchDbHandle = typeof db | RunGenerationTransaction;

const defaultDependencies: AsyncRunnerDependencies = {
  config: env,
  enqueue: enqueueRunGeneration,
  fetch: (input, init) => fetch(input, init),
};

/** True only for an explicitly enabled production runner; local/test always stay synchronous. */
export function asynchronousRunnerEnabled(config: AsyncRunnerConfig = env): boolean {
  return config.APP_MODE === 'production' && config.ATHENA_ASYNC_RUNNER_ENABLED === true;
}

function configuredRunner(config: AsyncRunnerConfig): {
  readonly url: string;
  readonly secret: string;
} {
  if (!config.CLOUDFLARE_ATHENA_RUNNER_URL || !config.DOCKET_TO_CLOUDFLARE_HMAC_SECRET) {
    throw new Error('Asynchronous Athena runner is enabled without its required configuration');
  }
  return {
    url: config.CLOUDFLARE_ATHENA_RUNNER_URL,
    secret: config.DOCKET_TO_CLOUDFLARE_HMAC_SECRET,
  };
}

/** Capped exponential delay after a persisted delivery failure. */
export function dispatchRetryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 86_400_000);
}

/** Insert the unique wake intent on the same transaction as a human continuation mutation. */
export async function persistWaitingAthenaWake(
  handle: DispatchDbHandle,
  sessionId: string,
  now = new Date(),
): Promise<QueuedRunGeneration> {
  const [waiting] = await handle
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  if (waiting?.status !== 'waiting') {
    throw new ConflictError('Session has no waiting Athena generation');
  }
  await handle
    .insert(agentSessionDispatch)
    .values({ runId: waiting.id, action: 'wake', availableAt: now })
    .onConflictDoNothing({
      target: [agentSessionDispatch.runId, agentSessionDispatch.action],
    });
  return {
    runId: waiting.id,
    message: {
      sessionId: waiting.sessionId,
      generation: waiting.generation,
      workflowId: waiting.workflowInstanceId,
    },
  };
}

/** Persist a wake intent when the continuation itself has no other database mutation. */
export async function queueWaitingAthenaWake(sessionId: string): Promise<QueuedRunGeneration> {
  return db.transaction((tx) => persistWaitingAthenaWake(tx, sessionId));
}

/** Send one opaque generation to the runner after it already exists in Docket. */
export async function dispatchRunnerMessage(
  action: AgentSessionDispatchAction,
  message: RunGenerationMessage,
  dependencies: AsyncDispatchDependencies = defaultDependencies,
): Promise<void> {
  const runner = configuredRunner(dependencies.config);
  const path = `/${action}`;
  const body = JSON.stringify(message);
  const headers = signInternalRequest({
    secret: runner.secret,
    method: 'POST',
    path,
    body,
  });
  let response: Response;
  try {
    response = await dependencies.fetch(new URL(path, runner.url), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_RUNNER_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(503, 'internal', 'Athena runner dispatch failed');
  }
  if (response.status !== 202) {
    throw new ApiError(503, 'internal', 'Athena runner dispatch failed');
  }
}

async function claimDispatch(
  now: Date,
  leaseDurationMs: number,
  target?: { readonly runId: string; readonly action: AgentSessionDispatchAction },
): Promise<ClaimedDispatch | null> {
  const token = genId();
  return db.transaction(async (tx) => {
    const due = or(
      and(eq(agentSessionDispatch.status, 'pending'), lte(agentSessionDispatch.availableAt, now)),
      and(
        eq(agentSessionDispatch.status, 'delivering'),
        lte(agentSessionDispatch.leaseExpiresAt, now),
      ),
      and(
        eq(agentSessionDispatch.status, 'delivered'),
        lte(
          agentSessionDispatch.deliveredAt,
          new Date(now.getTime() - DEFAULT_DISPATCH_RECONCILIATION_MS),
        ),
        or(
          and(eq(agentSessionDispatch.action, 'enqueue'), eq(agentSessionRun.status, 'queued')),
          and(eq(agentSessionDispatch.action, 'wake'), eq(agentSessionRun.status, 'waiting')),
        ),
      ),
    );
    const rows = await tx
      .select({ intent: agentSessionDispatch, run: agentSessionRun })
      .from(agentSessionDispatch)
      .innerJoin(agentSessionRun, eq(agentSessionRun.id, agentSessionDispatch.runId))
      .where(
        target
          ? and(
              eq(agentSessionDispatch.runId, target.runId),
              eq(agentSessionDispatch.action, target.action),
              due,
            )
          : due,
      )
      .orderBy(asc(agentSessionDispatch.availableAt), asc(agentSessionDispatch.id))
      .limit(1)
      .for('update', { skipLocked: true });
    const candidate = rows[0];
    if (!candidate) return null;
    const priorLeaseToken = candidate.intent.leaseToken;
    let claimOwnership;
    if (candidate.intent.status === 'delivering') {
      if (priorLeaseToken === null) return null;
      claimOwnership = and(
        eq(agentSessionDispatch.id, candidate.intent.id),
        eq(agentSessionDispatch.status, 'delivering'),
        eq(agentSessionDispatch.leaseToken, priorLeaseToken),
      );
    } else {
      claimOwnership = and(
        eq(agentSessionDispatch.id, candidate.intent.id),
        eq(agentSessionDispatch.status, candidate.intent.status),
      );
    }
    const [claimed] = await tx
      .update(agentSessionDispatch)
      .set({
        status: 'delivering',
        attempt: candidate.intent.status === 'delivered' ? 1 : candidate.intent.attempt + 1,
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        lastError: null,
        updatedAt: now,
      })
      .where(claimOwnership)
      .returning({ attempt: agentSessionDispatch.attempt });
    if (!claimed) return null;
    return {
      id: candidate.intent.id,
      runId: candidate.run.id,
      action: candidate.intent.action,
      attempt: claimed.attempt,
      leaseToken: token,
      message: {
        sessionId: candidate.run.sessionId,
        generation: candidate.run.generation,
        workflowId: candidate.run.workflowInstanceId,
      },
    };
  });
}

async function deliverClaimedDispatch(
  claimed: ClaimedDispatch,
  now: Date,
  dependencies: AsyncDispatchDependencies,
): Promise<DeliveryResult> {
  try {
    await dispatchRunnerMessage(claimed.action, claimed.message, dependencies);
    const [delivered] = await db
      .update(agentSessionDispatch)
      .set({
        status: 'delivered',
        leaseToken: null,
        leaseExpiresAt: null,
        deliveredAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentSessionDispatch.id, claimed.id),
          eq(agentSessionDispatch.status, 'delivering'),
          eq(agentSessionDispatch.leaseToken, claimed.leaseToken),
        ),
      )
      .returning({ id: agentSessionDispatch.id });
    if (!delivered) throw new ConflictError('Athena dispatch lease was lost');
    return 'delivered';
  } catch {
    const exhausted = claimed.attempt >= MAX_DISPATCH_ATTEMPTS;
    await db.transaction(async (tx) => {
      const [recorded] = await tx
        .update(agentSessionDispatch)
        .set({
          status: exhausted ? 'failed' : 'pending',
          availableAt: exhausted
            ? now
            : new Date(now.getTime() + dispatchRetryDelayMs(claimed.attempt)),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'Athena runner delivery failed',
          updatedAt: now,
        })
        .where(
          and(
            eq(agentSessionDispatch.id, claimed.id),
            eq(agentSessionDispatch.status, 'delivering'),
            eq(agentSessionDispatch.leaseToken, claimed.leaseToken),
          ),
        )
        .returning({ id: agentSessionDispatch.id });
      if (!recorded) throw new ConflictError('Athena dispatch lease was lost');
      if (exhausted && claimed.action === 'enqueue') {
        const [failedRun] = await tx
          .update(agentSessionRun)
          .set({
            status: 'failed',
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: 'Athena runner delivery failed',
            completedAt: now,
          })
          .where(and(eq(agentSessionRun.id, claimed.runId), eq(agentSessionRun.status, 'queued')))
          .returning({ sessionId: agentSessionRun.sessionId });
        if (failedRun) {
          await tx
            .update(agentSession)
            .set({ status: 'failed', endedAt: now })
            .where(
              and(eq(agentSession.id, failedRun.sessionId), eq(agentSession.status, 'running')),
            );
        }
      }
    });
    return exhausted ? 'failed' : 'retried';
  }
}

/** Claim and attempt one exact persisted dispatch intent. */
export async function deliverAthenaDispatch(
  runId: string,
  action: AgentSessionDispatchAction,
  dependencies: AsyncDispatchDependencies = defaultDependencies,
): Promise<DeliveryResult | 'in_progress'> {
  const now = new Date();
  const claimed = await claimDispatch(now, DEFAULT_DISPATCH_LEASE_MS, { runId, action });
  if (!claimed) {
    const [existing] = await db
      .select({ status: agentSessionDispatch.status })
      .from(agentSessionDispatch)
      .where(and(eq(agentSessionDispatch.runId, runId), eq(agentSessionDispatch.action, action)))
      .limit(1);
    if (existing?.status === 'delivered') return 'delivered';
    if (existing?.status === 'pending' || existing?.status === 'delivering') return 'in_progress';
    if (existing?.status === 'failed') return 'failed';
    throw new ConflictError('Athena dispatch intent is unavailable');
  }
  return deliverClaimedDispatch(claimed, now, dependencies);
}

/** Claim and retry a bounded set of due dispatch intents. */
export async function sweepAthenaDispatches(
  options: DispatchSweepOptions = {},
  dependencies: AsyncDispatchDependencies = defaultDependencies,
): Promise<DispatchSweepResult> {
  const fixedNow = options.now;
  const clock = options.clock ?? (fixedNow ? () => fixedNow : () => new Date());
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? DEFAULT_DISPATCH_SWEEP_SIZE, DEFAULT_DISPATCH_SWEEP_SIZE),
  );
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_DISPATCH_LEASE_MS;
  const result = { claimed: 0, delivered: 0, retried: 0, failed: 0 };
  for (let index = 0; index < batchSize; index += 1) {
    const claimTime = clock();
    const claimed = await claimDispatch(claimTime, leaseDurationMs);
    if (!claimed) break;
    result.claimed += 1;
    const delivery = await deliverClaimedDispatch(claimed, claimTime, dependencies);
    result[delivery] += 1;
  }
  return result;
}

/** Persist and dispatch a generation, or leave the caller on the existing synchronous path. */
export async function admitAthenaGeneration(
  session: SessionRow,
  options: RunGenerationOptions = {},
  dependencies: AsyncRunnerDependencies = defaultDependencies,
): Promise<AthenaGenerationAdmission> {
  if (!asynchronousRunnerEnabled(dependencies.config)) return { mode: 'sync' };
  const queued = await dependencies.enqueue(session, options);
  const delivery = await deliverAthenaDispatch(queued.runId, 'enqueue', dependencies);
  if (delivery === 'failed') {
    throw new ApiError(503, 'internal', 'Athena runner dispatch failed');
  }
  return { mode: 'async', queued };
}

/** Wake the latest human-waiting Workflow through its already-persisted outbox intent. */
export async function wakeWaitingAthenaGeneration(
  sessionId: string,
  dependencies: AsyncDispatchDependencies = defaultDependencies,
): Promise<RunGenerationMessage> {
  const [waiting] = await db
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  if (waiting?.status !== 'waiting') {
    throw new ConflictError('Session has no waiting Athena generation');
  }
  const delivery = await deliverAthenaDispatch(waiting.id, 'wake', dependencies);
  if (delivery === 'failed') {
    throw new ApiError(503, 'internal', 'Athena runner dispatch failed');
  }
  return {
    sessionId: waiting.sessionId,
    generation: waiting.generation,
    workflowId: waiting.workflowInstanceId,
  };
}
