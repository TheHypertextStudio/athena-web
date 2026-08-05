import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collectPages,
  GENERATED_PATH,
  patternFor,
  renderRouteModule,
  resolveAllRoutes,
  ROUTES_NOT_IN_TABLE,
} from '../../scripts/offline-route-policy';
import { ROUTE_PATTERNS } from '@/lib/offline-routes.generated';

/**
 * The offline route table is generated, and this is what keeps it honest.
 *
 * @remarks
 * A stale table does not fail loudly. It fails as a route that renders nothing offline, months
 * after the page was added, to whoever happens to have lost their connection. So the check is not
 * "does the table look plausible" but "does regenerating it produce exactly what is committed".
 */
describe('the generated offline route table', () => {
  it('matches what the generator would write for the current route tree', () => {
    const expected = renderRouteModule(resolveAllRoutes());
    const committed = readFileSync(GENERATED_PATH, 'utf8');

    expect(committed).toBe(expected);
  });

  it('accounts for every page under the authenticated route group', () => {
    const covered = new Set([...ROUTE_PATTERNS, ...Object.keys(ROUTES_NOT_IN_TABLE)]);
    const missing = collectPages()
      .map((page) => patternFor(page))
      .filter((pattern) => !covered.has(pattern));

    expect(missing).toEqual([]);
  });

  it('excuses a route from having offline UI only with a stated reason', () => {
    for (const [pattern, reason] of Object.entries(ROUTES_NOT_IN_TABLE)) {
      expect(reason, `${pattern} needs a reason, not an empty string`).not.toBe('');
    }
  });

  it('claims no pattern that no longer has a page', () => {
    const real = new Set(collectPages().map((page) => patternFor(page)));
    const orphaned = [...ROUTE_PATTERNS, ...Object.keys(ROUTES_NOT_IN_TABLE)].filter(
      (pattern) => !real.has(pattern),
    );

    expect(orphaned).toEqual([]);
  });
});
