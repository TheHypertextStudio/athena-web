/**
 * `routes/time-public` — the token-authorized, cross-origin read of "what am I working on".
 *
 * @remarks
 * This is the ONLY Docket route that answers without a session, and it is mounted outside `/v1`
 * on purpose: `/v1` is gated by `requireAuth` and its CORS policy is a credentialed allowlist of
 * first-party origins, which is exactly right for everything else and exactly wrong for a widget
 * on someone's own website. Keeping the exception in its own file, at its own path, makes the
 * blast radius visible — there is one route here and it returns one sentence.
 *
 * Authorization is a share token in the {@link SHARE_TOKEN_HEADER} header, never a query string:
 * a credential in a URL ends up in browser history, referrer headers and access logs. The
 * response is `no-store` because "what I am doing right now" is by definition not cacheable, and
 * a CDN answering with a stale task would be worse than not answering.
 */
import { PublicTimerStatusOut } from '@docket/planning/time-share-contract';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { readSharedTimerStatus, SHARE_TOKEN_HEADER } from '../time/service';

/**
 * The absolute path a widget polls, relative to the API origin.
 *
 * @remarks
 * Kept in lock-step with `PUBLIC_SHARE_PATHS` in `cors.ts`, which is what makes the route
 * readable from a foreign origin. A test asserts the two agree, because a silent drift here
 * would produce a widget that works from curl and fails in every browser.
 */
export const SHARED_TIMER_STATUS_PATH = '/v1/public/time/status';

/**
 * Build the copy-pasteable snippet handed to the owner once, at mint time.
 *
 * @remarks
 * Written as a self-contained `<script>` with no build step, no dependency and no framework,
 * because the person pasting it owns a personal site, not a bundler. It renders into whatever
 * element carries `id="docket-timer"`, re-reads every 30 seconds, and ticks the elapsed value
 * locally from `serverNow` in between so the number moves without hammering the API.
 *
 * @param statusUrl - The absolute status endpoint.
 * @param token - The raw share token (shown to its owner exactly once).
 * @returns HTML the owner can paste into any page.
 */
export function sharedTimerEmbedSnippet(statusUrl: string, token: string): string {
  return `<div id="docket-timer">…</div>
<script>
(function () {
  var el = document.getElementById('docket-timer');
  var state = null;
  function human(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }
  function paint() {
    if (!state) return;
    if (state.state === 'idle') { el.textContent = 'Not working right now'; return; }
    var drift = state.state === 'running' ? Date.now() - state.readAt : 0;
    var verb = state.state === 'running' ? 'Working on' : 'Paused on';
    var what = state.taskTitle || 'something';
    el.textContent = verb + ' ' + what + ' — ' + human(state.elapsedMs + drift);
  }
  function load() {
    fetch(${JSON.stringify(statusUrl)}, { headers: { '${SHARE_TOKEN_HEADER}': ${JSON.stringify(token)} } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) { if (body) { body.readAt = Date.now(); state = body; paint(); } })
      .catch(function () {});
  }
  load();
  setInterval(load, 30000);
  setInterval(paint, 1000);
})();
</script>`;
}

/**
 * The public share surface.
 *
 * @remarks
 * The open, credential-free CORS policy comes from the root server (`cors.ts`), which recognises
 * this exact path. Declaring it there rather than here means the complete list of routes a
 * foreign origin can reach is readable in one file, instead of being assembled by grepping for
 * `cors()` calls scattered through the route tree.
 */
const timePublic = new Hono<AppEnv>().get('/status', async (c) => {
  const token = c.req.header(SHARE_TOKEN_HEADER);
  if (!token) throw new AuthError('Share token is required');
  c.header('Cache-Control', 'no-store');
  return ok(c, PublicTimerStatusOut, await readSharedTimerStatus(token));
});

export default timePublic;
