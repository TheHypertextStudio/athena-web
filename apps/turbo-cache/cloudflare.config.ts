import { bindings, defineConfig } from 'cf/config';
import { cacheConfig } from './src/config.ts';

/** Native cf deployment with a private binding and one authenticated custom domain. */
export default defineConfig({
  accountId: cacheConfig.accountId,
  worker: {
    name: cacheConfig.workerName,
    compatibilityDate: cacheConfig.compatibilityDate,
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: 'src/index.ts',
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true },
    domains: [cacheConfig.domain],
    env: {
      OIDC_AUDIENCE: bindings.text(cacheConfig.bindings.OIDC_AUDIENCE),
      CACHE_CLIENTS: bindings.text(cacheConfig.bindings.CACHE_CLIENTS),
      R2_STORE: bindings.r2({ name: cacheConfig.bucketName }),
    },
  },
});
