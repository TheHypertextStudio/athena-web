/** Root Worker and artifact entrypoints share the source-owned runtime contract. */
export {
  assertProviderRuntimeConfig,
  isWorkerApplicationHost,
  readWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from './src/lib/worker-runtime-config';
