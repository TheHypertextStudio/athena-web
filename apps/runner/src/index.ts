import { resolveCronMode, runScheduledCronSweeps } from './cron-sweeps';
import { consumeExecutionBatch } from './queue';
import { createRunnerFetchHandler, type RunnerHttpEnv } from './http';
import { runDispatchSweep } from './scheduled';

export { AthenaExecutionWorkflow } from './workflow';

const handleFetch = createRunnerFetchHandler();
type RunnerEnv = Cloudflare.Env &
  RunnerHttpEnv & {
    readonly CRON_SECRET?: string;
    readonly DOCKET_CRON_MODE?: string;
  };

/** Cloudflare module Worker that consumes opaque run messages and scheduled sweeps. */
export default {
  async fetch(request, env): Promise<Response> {
    return handleFetch(request, env);
  },
  async queue(batch: MessageBatch, env: RunnerEnv): Promise<void> {
    await consumeExecutionBatch(batch.messages, env.ATHENA_WORKFLOW);
  },
  async scheduled(controller, env): Promise<void> {
    const result = await runDispatchSweep(env);
    console.log(JSON.stringify({ event: 'athena_dispatch_sweep_completed', ...result }));
    if (resolveCronMode(env.DOCKET_CRON_MODE) !== 'off') {
      const now = controller.scheduledTime ? new Date(controller.scheduledTime) : new Date();
      const cronSummary = await runScheduledCronSweeps(env, { fetch, now });
      console.log(JSON.stringify({ event: 'docket_cron_sweep_completed', ...cronSummary }));
    }
  },
} satisfies ExportedHandler<RunnerEnv>;
