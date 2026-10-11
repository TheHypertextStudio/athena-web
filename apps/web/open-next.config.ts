import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

// Keep native Next streaming and the retained R2 cache seed. Deployment is owned by the shared
// release engine; Vercel remains active until the isolated Workers candidate is accepted.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  enableCacheInterception: false,
});
