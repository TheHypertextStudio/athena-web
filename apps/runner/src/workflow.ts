import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { signInternalRequest } from './hmac';
import { isExecutionMessage } from './protocol';
import type { ExecutionMessage } from './protocol';

/** Docket callback configuration shared by Workflow and scheduled requests. */
export interface DocketWorkflowEnv {
  readonly DOCKET_API_URL: string;
  readonly CLOUDFLARE_TO_DOCKET_HMAC_SECRET: string;
}

/** Application secrets intentionally omitted from generated binding interfaces. */
export type RunnerEnv = Pick<Cloudflare.Env, 'ATHENA_RUN_QUEUE'> & DocketWorkflowEnv;
/** Per-generation callback deadline; Athena's overall work has no duration cap. */
export const DEFAULT_GENERATION_REQUEST_TIMEOUT_MS = 15 * 60_000;

/** Injectable Workflow-to-Docket transport. */
export interface WorkflowHttpDependencies {
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

/** A bounded Docket result that never includes prompts, credentials, or owner identity. */
export type GenerationAdvance =
  | { readonly state: 'complete' | 'failed' }
  | { readonly state: 'wait' }
  | { readonly state: 'continue'; readonly next: ExecutionMessage };

/** Workflow step subset used by the deterministic orchestration loop. */
export interface GenerationWorkflowStep {
  readonly do: <T>(name: string, callback: () => Promise<T>) => Promise<T>;
  readonly waitForEvent: (
    name: string,
    options: { readonly type: string; readonly timeout: '365 days' },
  ) => Promise<unknown>;
}

/** Injectable effects around the durable Workflow state machine. */
export interface GenerationWorkflowEffects {
  readonly advance: (
    message: ExecutionMessage,
    reason: 'run' | 'wake',
  ) => Promise<GenerationAdvance>;
  readonly dispatch: (message: ExecutionMessage) => Promise<void>;
}

/**
 * Recognize only Cloudflare's event-wait timeout exception.
 *
 * @remarks
 * The Workflows API documents that `waitForEvent` throws on timeout but currently exports no
 * stable timeout class. Workers uses the platform-standard `TimeoutError` name; the message check
 * is deliberately bounded to the documented operation so unrelated storage/RPC errors escape.
 */
export function isWorkflowEventTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'TimeoutError' &&
    /^waitForEvent timed out(?:\b|$)/i.test(error.message)
  );
}

/**
 * Advance one persisted generation, wait durably when Docket needs a person, and fan out the next.
 *
 * @remarks
 * Cloudflare caps one event wait at 365 days, so a timed-out wait immediately enters another
 * deterministically named epoch. Docket remains the source of truth; an eventual wake advances
 * the same session by creating the next persisted generation.
 */
export async function executeGenerationWorkflow(
  message: ExecutionMessage,
  step: GenerationWorkflowStep,
  effects: GenerationWorkflowEffects,
): Promise<void> {
  let advance = await step.do('advance-generation', () => effects.advance(message, 'run'));
  let epoch = 1;
  while (advance.state === 'wait') {
    try {
      await step.waitForEvent(`wait-for-wake-${String(epoch)}`, {
        type: 'docket_wake',
        timeout: '365 days',
      });
    } catch (error) {
      if (!isWorkflowEventTimeout(error)) throw error;
      epoch += 1;
      continue;
    }
    advance = await step.do(`advance-wake-${String(epoch)}`, () =>
      effects.advance(message, 'wake'),
    );
    epoch += 1;
  }
  if (advance.state === 'continue') {
    await step.do(`dispatch-generation-${String(advance.next.generation)}`, () =>
      effects.dispatch(advance.next),
    );
  }
}

/** Call Docket's protected internal generation endpoint with the Cloudflare-direction secret. */
export async function advanceDocket(
  env: DocketWorkflowEnv,
  message: ExecutionMessage,
  reason: 'run' | 'wake',
  dependencies: WorkflowHttpDependencies = { fetch },
): Promise<GenerationAdvance> {
  const path = '/internal/athena/execution/advance';
  const body = JSON.stringify({ ...message, reason });
  const headers = await signInternalRequest({
    secret: env.CLOUDFLARE_TO_DOCKET_HMAC_SECRET,
    method: 'POST',
    path,
    body,
  });
  const signal = AbortSignal.timeout(
    dependencies.timeoutMs ?? DEFAULT_GENERATION_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await dependencies.fetch(new URL(path, env.DOCKET_API_URL), {
      method: 'POST',
      headers,
      body,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error('Docket generation advance timed out', { cause: error });
    throw error;
  }
  if (!response.ok)
    throw new Error(`Docket generation advance failed (${String(response.status)})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Docket generation advance returned an invalid response');
  }
  const record = result as Record<string, unknown>;
  if (
    record['state'] === 'complete' ||
    record['state'] === 'failed' ||
    record['state'] === 'wait'
  ) {
    return { state: record['state'] };
  }
  if (record['state'] === 'continue' && isExecutionMessage(record['next'])) {
    return { state: 'continue', next: record['next'] };
  }
  throw new Error('Docket generation advance returned an invalid state');
}

/** Durable Workflow class bound from `wrangler.jsonc`. */
export class AthenaExecutionWorkflow extends WorkflowEntrypoint<RunnerEnv, ExecutionMessage> {
  override async run(event: WorkflowEvent<ExecutionMessage>, step: WorkflowStep): Promise<void> {
    await executeGenerationWorkflow(event.payload, step, {
      advance: (message, reason) => advanceDocket(this.env, message, reason),
      dispatch: async (message) => {
        await this.env.ATHENA_RUN_QUEUE.send(message, { contentType: 'json' });
      },
    });
  }
}
