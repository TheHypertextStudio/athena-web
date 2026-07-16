/** Docket-side admission and signed dispatch for durable Athena generations. */
import { agentSessionRun, db } from '@docket/db';
import { desc, eq } from 'drizzle-orm';

import { ApiError, ConflictError } from '../error';
import { env } from '../env';
import type { SessionRow } from '../routes/agent-session-helpers';
import { signInternalRequest } from './execution-hmac';
import {
  enqueueRunGeneration,
  type QueuedRunGeneration,
  type RunGenerationMessage,
  type RunGenerationOptions,
} from './run-generation';

/** Minimal config needed to choose and authenticate the execution path. */
export interface AsyncRunnerConfig {
  readonly APP_MODE?: 'local' | 'test' | 'production';
  readonly ATHENA_ASYNC_RUNNER_ENABLED?: boolean;
  readonly CLOUDFLARE_ATHENA_RUNNER_URL?: string;
  readonly DOCKET_TO_CLOUDFLARE_HMAC_SECRET?: string;
}

/** Injectable effects for deterministic admission tests. */
export interface AsyncRunnerDependencies {
  readonly config: AsyncRunnerConfig;
  readonly enqueue: typeof enqueueRunGeneration;
  readonly fetch: (input: URL, init: RequestInit) => Promise<Response>;
}

/** Synchronous fallback or accepted asynchronous generation. */
export type AthenaGenerationAdmission =
  | { readonly mode: 'sync' }
  | { readonly mode: 'async'; readonly queued: QueuedRunGeneration };

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

/** Send one opaque generation to the runner after it already exists in Docket. */
export async function dispatchRunnerMessage(
  action: 'enqueue' | 'wake',
  message: RunGenerationMessage,
  dependencies: Pick<AsyncRunnerDependencies, 'config' | 'fetch'> = defaultDependencies,
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
  const response = await dependencies.fetch(new URL(path, runner.url), {
    method: 'POST',
    headers,
    body,
  });
  if (!response.ok) {
    throw new ApiError(503, 'internal', `Athena runner ${action} failed`);
  }
}

/** Persist and dispatch a generation, or leave the caller on the existing synchronous path. */
export async function admitAthenaGeneration(
  session: SessionRow,
  options: RunGenerationOptions = {},
  dependencies: AsyncRunnerDependencies = defaultDependencies,
): Promise<AthenaGenerationAdmission> {
  if (!asynchronousRunnerEnabled(dependencies.config)) return { mode: 'sync' };
  const queued = await dependencies.enqueue(session, options);
  await dispatchRunnerMessage('enqueue', queued.message, dependencies);
  return { mode: 'async', queued };
}

/** Wake the latest human-waiting Workflow for a session after Docket persists the response. */
export async function wakeWaitingAthenaGeneration(
  sessionId: string,
  dependencies: Pick<AsyncRunnerDependencies, 'config' | 'fetch'> = defaultDependencies,
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
  const message = {
    sessionId: waiting.sessionId,
    generation: waiting.generation,
    workflowId: waiting.workflowInstanceId,
  };
  await dispatchRunnerMessage('wake', message, dependencies);
  return message;
}
