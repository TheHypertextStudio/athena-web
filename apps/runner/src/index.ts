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
    let dispatchError: Error | undefined;
    const hmacSecret = (env as { readonly CLOUDFLARE_TO_DOCKET_HMAC_SECRET?: string })
      .CLOUDFLARE_TO_DOCKET_HMAC_SECRET;
    if (typeof hmacSecret === 'string' && hmacSecret.trim().length > 0) {
      try {
        const result = await runDispatchSweep(env);
        console.log(JSON.stringify({ event: 'athena_dispatch_sweep_completed', ...result }));
      } catch (error) {
        dispatchError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (resolveCronMode(env.DOCKET_CRON_MODE) !== 'off') {
      const now = controller.scheduledTime ? new Date(controller.scheduledTime) : new Date();
      const cronSummary = await runScheduledCronSweeps(env, { fetch, now });
      console.log(JSON.stringify({ event: 'docket_cron_sweep_completed', ...cronSummary }));
    }
    if (dispatchError) throw dispatchError;
  },
} satisfies ExportedHandler<RunnerEnv>;
