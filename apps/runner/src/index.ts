import { consumeExecutionBatch } from './queue';
import { createRunnerFetchHandler, type RunnerHttpEnv } from './http';

export { AthenaExecutionWorkflow } from './workflow';

const handleFetch = createRunnerFetchHandler();
type RunnerEnv = Cloudflare.Env & RunnerHttpEnv;

/** Cloudflare module Worker that consumes opaque run messages. */
export default {
  async fetch(request, env): Promise<Response> {
    return handleFetch(request, env);
  },
  async queue(batch: MessageBatch, env: RunnerEnv): Promise<void> {
    await consumeExecutionBatch(batch.messages, env.ATHENA_WORKFLOW);
  },
} satisfies ExportedHandler<RunnerEnv>;
