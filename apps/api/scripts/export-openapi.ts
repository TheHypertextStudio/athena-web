/**
 * `@docket/api` — write the public `/v1` OpenAPI document to a file.
 *
 * @remarks
 * For when a file is needed — generating a client, diffing the surface, feeding a linter.
 * `/v1/openapi.json` from the running service is the copy to trust.
 *
 * @example
 * ```sh
 * pnpm --filter @docket/api openapi:export
 * ```
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Anchored to this package, not `process.cwd()`: it is the path `.gitignore` names. */
const OUTPUT = resolve(import.meta.dirname, '../openapi.json');

/**
 * The minimum the API's module graph needs to import without throwing.
 *
 * Its own rather than the test suite's `API_TEST_ENV`, which `domain-import-policy.test.ts` forbids
 * a `scripts/` entrypoint from importing.
 */
const EXPORT_ENV = {
  SKIP_ENV_VALIDATION: '1',
  APP_MODE: 'test',
  NODE_ENV: 'test',
  DATABASE_URL: 'pglite://memory://',
  API_URL: 'https://api.docket.localhost',
  WEB_URL: 'https://docket.localhost',
  BETTER_AUTH_URL: 'https://api.docket.localhost',
  BETTER_AUTH_SECRET: 'export-only-secret-export-only-secret-0123',
} as const;

/** Generate the `/v1` document and write it as formatted JSON. */
async function main(): Promise<void> {
  Object.assign(process.env, EXPORT_ENV);

  // Imported after the env assignment above: a static import would hoist over it, and the app's
  // module-scope env validation would then run against an unset environment.
  const { openapiDocument } = await import('../src/openapi');
  const { app, adminApp } = await import('../src/app');

  const spec = await openapiDocument(app, adminApp);
  writeFileSync(OUTPUT, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT}\n`);
}

await main();
