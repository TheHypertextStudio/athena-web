/**
 * `@docket/api` — package entry exposing the typed RPC contract to consumers.
 *
 * @remarks
 * Clients do `import { hc } from 'hono/client'` + `import type { AppType } from
 * '@docket/api'`. Importing this entry is side-effect-free (no server boot — that
 * lives in `server.ts`).
 */
export type { AppType } from './app';
export { app } from './app';
