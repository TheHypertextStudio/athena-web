/**
 * The public timer read is only reachable if three files agree on one path.
 *
 * @remarks
 * `routes/time-public.ts` declares it, `server.ts` mounts it outside the session-gated `/v1` app,
 * and `cors.ts` exempts it from the credentialed first-party allowlist. Any one of those drifting
 * produces a widget that fails in a way no unit test would notice: mount it wrong and it 404s,
 * forget the CORS entry and it works in curl and fails in every browser. Reading the sources is
 * the only way to check the last two without importing the whole route tree, which a concurrent
 * edit to any unrelated router would break.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { SHARED_TIMER_STATUS_PATH } from '../../src/routes/time-public';

/** Read one API source file as text. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/${relative}`, import.meta.url)), 'utf8');
}

describe('public timer wiring', () => {
  it('mounts the public router at the declared path, outside the /v1 app', () => {
    const server = source('server.ts');
    const mount = "server.route('/v1/public/time', timePublic);";
    expect(server).toContain(mount);
    expect(SHARED_TIMER_STATUS_PATH).toBe('/v1/public/time/status');
    // Mounted BEFORE the typed `/v1` app, or `requireAuth` would claim the path first.
    expect(server.indexOf(mount)).toBeLessThan(server.indexOf("server.route('/', app);"));
  });

  it('exempts exactly that path from the credentialed CORS allowlist', () => {
    const cors = source('cors.ts');
    expect(cors).toContain(`'${SHARED_TIMER_STATUS_PATH}'`);
    expect(cors).toContain('PUBLIC_SHARE_PATHS');
    expect(cors).toContain('SHARE_TOKEN_HEADER');
  });

  it('keeps the share-token header spelled the same in policy and in the handler', async () => {
    const { SHARE_TOKEN_HEADER } = await import('../../src/time/share');
    // CORS header matching is case-insensitive, so the two may differ in case but not in name.
    expect(source('cors.ts').toLowerCase()).toContain(SHARE_TOKEN_HEADER.toLowerCase());
  });

  /**
   * Two independently-built routers now sit under `/v1/public`: the anonymous published brief at
   * `/v1/public/briefs/:workspace/:slug` and this timer read at `/v1/public/time/status`. They were
   * written separately, and each is tested against a composition containing only itself, so neither
   * suite can see the one failure mounting them together could produce — the earlier mount claiming
   * a path the later one owns, which turns the widget into a silent 404 in production only.
   */
  it('does not let the published-brief router shadow the timer read, or vice versa', async () => {
    const { Hono } = await import('hono');
    const { onError } = await import('../../src/error');
    const publicBriefs = (await import('../../src/routes/publish-public')).default;
    const timePublic = (await import('../../src/routes/time-public')).default;

    // The same two mounts, in the same order, as `server.ts`.
    const composed = new Hono<AppEnv>();
    composed.onError(onError);
    composed.route('/v1/public', publicBriefs);
    composed.route('/v1/public/time', timePublic);

    // The load-bearing check. This request carries no share token, so the timer read's own answer
    // is 401 — a status it can only produce if the request actually reached it. A 404 would mean
    // no route matched (the brief mount having claimed the path first), which is precisely the
    // shadowing failure neither router's own suite can observe.
    const timer = await composed.request(SHARED_TIMER_STATUS_PATH);
    expect(timer.status).toBe(401);

    // And the brief path still reaches its own router rather than being swallowed by the timer
    // mount: it answers in Problem shape, where a routing miss would be a bare framework 404.
    const brief = await composed.request('/v1/public/briefs/unknown-workspace/unknown-brief');
    expect(brief.headers.get('content-type')).toContain('json');
  });
});
