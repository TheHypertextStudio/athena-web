/** Authenticated Cloudflare Workflow callbacks over Docket-owned execution state. */
import { agentSession, agentSessionRun, db } from '@docket/db';
import { desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';
import type { SessionRow } from '../routes/agent-session-helpers';
import { driveClaimedGeneration } from './loop';
import {
  claimQueuedRunGeneration,
  enqueueRunGeneration,
  type ClaimedQueuedRunGeneration,
  type QueuedRunGeneration,
  type RunGenerationLease,
  type RunGenerationMessage,
  type RunGenerationOptions,
} from './run-generation';

/** Bounded state returned to a Workflow; no owner, prompt, tool, or credential data crosses. */
export type GenerationAdvance =
  | { readonly state: 'complete' | 'failed' | 'wait' }
  | { readonly state: 'continue'; readonly next: RunGenerationMessage };

/** Injectable generation boundaries used by the state-machine tests. */
export interface GenerationAdvanceDependencies {
  readonly claim: (message: RunGenerationMessage) => Promise<ClaimedQueuedRunGeneration>;
  readonly drive: (
    orgId: string,
    sessionId: string,
    lease: RunGenerationLease,
  ) => Promise<SessionRow>;
  readonly enqueue: (
    session: SessionRow,
    options?: RunGenerationOptions,
  ) => Promise<QueuedRunGeneration>;
  readonly loadWaiting: (message: RunGenerationMessage) => Promise<SessionRow>;
  readonly recover?: (message: RunGenerationMessage) => Promise<GenerationAdvance | null>;
}

async function recoverPersistedGeneration(
  message: RunGenerationMessage,
): Promise<GenerationAdvance | null> {
  const [run] = await db
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.workflowInstanceId, message.workflowId))
    .limit(1);
  if (
    run?.sessionId !== message.sessionId ||
    run.generation !== message.generation ||
    run.status === 'queued' ||
    run.status === 'running'
  ) {
    return null;
  }
  if (run.status === 'waiting') return { state: 'wait' };
  if (run.status === 'failed') return { state: 'failed' };
  if (run.status === 'canceled') return { state: 'complete' };

  const [session] = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, message.sessionId))
    .limit(1);
  if (!session) throw new NotFoundError('Session not found');
  if (session.status === 'failed') return { state: 'failed' };
  if (session.status === 'completed' || session.status === 'canceled') {
    return { state: 'complete' };
  }

  const [latest] = await db
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, message.sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  if (latest && latest.generation > message.generation) {
    return {
      state: 'continue',
      next: {
        sessionId: latest.sessionId,
        generation: latest.generation,
        workflowId: latest.workflowInstanceId,
      },
    };
  }
  if (session.status === 'running') {
    const next = await enqueueRunGeneration(session, { runnableStatuses: ['running'] });
    return { state: 'continue', next: next.message };
  }
  return null;
}

async function loadWaitingGeneration(message: RunGenerationMessage): Promise<SessionRow> {
  const [latest] = await db
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, message.sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  if (
    latest?.status !== 'waiting' ||
    latest.generation !== message.generation ||
    latest.workflowInstanceId !== message.workflowId
  ) {
    throw new ConflictError('Workflow generation is not the current human wait');
  }
  const [session] = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, message.sessionId))
    .limit(1);
  if (!session) throw new NotFoundError('Session not found');
  return session;
}

const defaultDependencies: GenerationAdvanceDependencies = {
  claim: claimQueuedRunGeneration,
  drive: driveClaimedGeneration,
  enqueue: enqueueRunGeneration,
  loadWaiting: loadWaitingGeneration,
  recover: recoverPersistedGeneration,
};

/** Advance one queued quantum or convert a persisted human response into its successor. */
export async function advanceCloudflareGeneration(
  message: RunGenerationMessage,
  reason: 'run' | 'wake',
  dependencies: GenerationAdvanceDependencies = defaultDependencies,
): Promise<GenerationAdvance> {
  if (reason === 'wake') {
    const waiting = await dependencies.loadWaiting(message);
    if (waiting.status === 'failed') return { state: 'failed' };
    if (waiting.status === 'completed' || waiting.status === 'canceled') {
      return { state: 'complete' };
    }
    if (waiting.status !== 'awaiting_input' && waiting.status !== 'awaiting_approval') {
      throw new ConflictError('Session is not waiting for a person');
    }
    const next = await dependencies.enqueue(waiting, {
      runnableStatuses: ['awaiting_input', 'awaiting_approval'],
    });
    return { state: 'continue', next: next.message };
  }

  let claimed: ClaimedQueuedRunGeneration;
  try {
    claimed = await dependencies.claim(message);
  } catch (error) {
    if (error instanceof ConflictError && dependencies.recover) {
      const recovered = await dependencies.recover(message);
      if (recovered) return recovered;
    }
    throw error;
  }
  const orgId = claimed.session.contextOrganizationId ?? claimed.session.organizationId ?? '';
  const settled = await dependencies.drive(orgId, message.sessionId, claimed.lease);
  if (settled.status === 'awaiting_input' || settled.status === 'awaiting_approval') {
    return { state: 'wait' };
  }
  if (settled.status === 'failed') return { state: 'failed' };
  if (settled.status === 'completed' || settled.status === 'canceled') {
    return { state: 'complete' };
  }
  if (settled.status !== 'running') {
    throw new ConflictError('Generation returned an unsupported session state');
  }
  const next = await dependencies.enqueue(settled, { runnableStatuses: ['running'] });
  return { state: 'continue', next: next.message };
}
