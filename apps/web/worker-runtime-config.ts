/** Root Worker and Next entrypoints share the source-owned runtime contract. */
export {
  isWorkerApplicationHost,
  readWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from './src/lib/worker-runtime-config';
