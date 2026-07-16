import { consumeExecutionBatch } from './queue';
import { createRunnerFetchHandler, type RunnerHttpEnv } from './http';
import { runDispatchSweep } from './scheduled';

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
  async scheduled(_controller, env): Promise<void> {
    const result = await runDispatchSweep(env);
    console.log(JSON.stringify({ event: 'athena_dispatch_sweep_completed', ...result }));
  },
} satisfies ExportedHandler<RunnerEnv>;
