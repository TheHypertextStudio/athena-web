import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/** Native OpenNext Cloudflare configuration for Docket's admin console Worker. */
export default defineCloudflareConfig({
  enableCacheInterception: false,
});
