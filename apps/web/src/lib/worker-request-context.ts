import { getCloudflareContext } from '@opennextjs/cloudflare';

import { readWorkerRuntimeConfig, type WorkerRuntimeConfig } from './worker-runtime-config';

/**
 * Read native request-local routing only in a compiled Workers build.
 * @returns The current Worker config, or undefined for the unchanged Node reference branch.
 * @throws When a Workers request lacks native context or valid routing inputs.
 */
export function workerRequestConfig(): WorkerRuntimeConfig | undefined {
  if (process.env.DOCKET_RUNTIME_TARGET !== 'workers') return undefined;
  return readWorkerRuntimeConfig(getCloudflareContext().env);
}
