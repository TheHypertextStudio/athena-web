import { readFile, writeFile } from 'node:fs/promises';

// Reuse the existing release runner's disposable backend, database and local passkey RP.
const appUrl = new URL(process.env['APP_URL'] ?? '');
const apiUrl = new URL(process.env['API_URL'] ?? '');
const briefHost = process.env['PUBLIC_BRIEF_HOST'];
if (
  appUrl.hostname !== 'docket.localhost' ||
  apiUrl.hostname !== 'api.docket.localhost' ||
  briefHost !== 'briefs.docket.localhost'
) {
  throw new Error(
    'Workers release acceptance requires isolated docket.localhost origins and briefs',
  );
}
const path = 'apps/web/.artifact/wrangler.site.jsonc';
const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
  throw new Error('Workers artifact configuration must be an object');
}
const config = raw as Record<string, unknown>;
config['name'] = 'docket-web-local';
// Production rejects private-network fetches. This local-only config deliberately permits
// the release runner's loopback API. It is never the provider deployment configuration.
const flags = config['compatibility_flags'];
if (!Array.isArray(flags) || !flags.every((flag) => typeof flag === 'string')) {
  throw new Error('Workers compatibility flags must be strings');
}
config['compatibility_flags'] = flags.filter((flag) => flag !== 'global_fetch_strictly_public');
config['services'] = [{ binding: 'WORKER_SELF_REFERENCE', service: config['name'] }];
config['r2_buckets'] = [
  { binding: 'NEXT_INC_CACHE_R2_BUCKET', bucket_name: 'docket-web-local-cache', remote: false },
];
config['vars'] = {
  API_URL: apiUrl.origin,
  WEB_URL: appUrl.origin,
  PUBLIC_BRIEF_HOST: briefHost,
  BETTER_AUTH_PASSKEY_RP_ID: appUrl.hostname,
  DOCKET_LOCAL_ACCEPTANCE: '1',
  NEXT_PUBLIC_API_URL: apiUrl.origin,
  NEXT_PUBLIC_APP_URL: appUrl.origin,
  NEXT_PUBLIC_PASSKEY_RP_ID: appUrl.hostname,
  BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
  STUDIO_DEPLOYMENT_ENV: 'staging',
};
delete config['env'];
await writeFile('apps/web/.artifact/wrangler.local.jsonc', JSON.stringify(config, null, 2) + '\n');
