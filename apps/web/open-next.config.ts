import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

// Native OpenNext preview/deploy/upload own R2 cache population and preserve Next streaming.
// Vercel remains active until the isolated Workers environment is accepted.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  enableCacheInterception: false,
});
