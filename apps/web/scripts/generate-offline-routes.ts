/**
 * `pnpm --filter @docket/web exec tsx scripts/generate-offline-routes.ts` — write
 * `src/lib/offline-routes.generated.ts` from the real route tree.
 *
 * @remarks
 * The offline route table has to name every route in `src/app/(app)` and the client module that
 * renders it. Maintaining that by hand would mean a table that silently disagrees with the app the
 * first time somebody adds a page — and the failure would surface as "this route is blank offline",
 * months later, to whoever happened to be on a train. So it is derived from the filesystem, and
 * `tests/lib/offline-routes.test.ts` asserts the committed output still matches.
 *
 * The rules, their exceptions, and the rendering all live in
 * {@link file://./offline-route-policy.ts}, shared with that test so the two cannot drift. This
 * file is only the entry point that writes what the policy produces.
 *
 * The output is committed rather than gitignored, unlike `public/sw.js`: `tsc` and ESLint both read
 * it, so a checkout that had not run the generator would fail to typecheck.
 */
import { writeFileSync } from 'node:fs';

import { GENERATED_PATH, renderRouteModule, resolveAllRoutes } from './offline-route-policy';

const routes = resolveAllRoutes();
writeFileSync(GENERATED_PATH, await renderRouteModule(routes), 'utf8');
process.stdout.write(`src/lib/offline-routes.generated.ts — ${String(routes.length)} routes\n`);
