/**
 * The REST conformance gate.
 *
 * @remarks
 * This suite is the reason `docs/engineering/specs/rest-conventions.md` is a standard rather
 * than a wish. It walks the **composed** route table — every path the real server serves, not
 * a hand-kept list — and fails when a route breaks a rule the conventions doc states.
 *
 * The two rules with legacy exceptions carry an explicit frozen allowlist. Those lists may
 * shrink and must never grow: a test asserts each entry still corresponds to a live route, so
 * an allowlist that outlives the route it excused fails instead of quietly licensing a new
 * one. Adding an endpoint that would need a new entry fails here, which is what keeps the
 * surface from drifting back.
 *
 * The response-mechanics cases drive the composed app end to end, because that is the only
 * place a `Location` header carries its real `/v1` prefix — a router mounted bare in a
 * sibling test resolves it against its own root and cannot prove the production value.
 */
import { beforeAll, describe, expect, it } from 'vitest';

/** One routable endpoint on a typed surface. */
interface Endpoint {
  readonly surface: 'v1' | 'admin';
  readonly method: string;
  readonly path: string;
}

/**
 * Verbs that name an operation rather than a thing.
 *
 * @remarks
 * A path segment is a noun for a resource; a verb in that position means the URL has stopped
 * addressing state and started naming a procedure, which is the RPC shape REST exists to
 * replace. The list is deliberately narrow — only words that can be nothing but imperatives,
 * so a legitimate noun (`state`, `presence`, `preferences`, `revisions`) never trips it.
 */
const ACTION_VERBS = new Set([
  'accept',
  'acknowledge',
  'act',
  'approve',
  'authorize',
  'backfill',
  'cancel',
  'close',
  'complete',
  'decide',
  'dismiss',
  'end',
  'fork',
  'hydrate',
  'import',
  'install',
  'invite',
  'materialize',
  'merge',
  'pause',
  'provision',
  'reactivate',
  'reconnect',
  'reject',
  'reorder',
  'reorganize',
  'resend',
  'resolve',
  'resume',
  'respond',
  'revoke',
  'run',
  'send',
  'start',
  'stop',
  'sync',
  'takeover',
  'test',
  'verify',
]);

/**
 * Routes that predate the conventions and still name an action in their path.
 *
 * @remarks
 * Frozen. Every entry is a URL some client already calls, so it is grandfathered rather than
 * blessed — `rest-conventions.md` §"Known exceptions" records what each should become. Shrink
 * this list by migrating a route and deleting its line; never extend it for a new one.
 */
const LEGACY_ACTION_PATHS: readonly string[] = [
  'POST /v1/directive/acknowledge',
  'POST /v1/directive/check-ins/:id/respond',
  'POST /v1/directive/day-start/acknowledge',
  'POST /v1/directive/day-start/decide',
  'POST /v1/directive/reorganize',
  'POST /v1/directive/review/answer',
  'POST /v1/directive/review/confirm-tomorrow',
  'POST /v1/hub/today/items/:planItemId/complete',
  'POST /v1/me/athena/connections/:id/authorize',
  'POST /v1/me/athena/connections/:id/reconnect',
  'POST /v1/me/athena/lattice/authorize',
  'POST /v1/me/athena/sessions/:id/cancel',
  'POST /v1/me/athena/sessions/:id/pause',
  'POST /v1/me/athena/sessions/:id/resume',
  'POST /v1/me/athena/sessions/:id/run',
  'POST /v1/me/contact-points/:id/verify',
  'POST /v1/me/phone-numbers/:id/resend',
  'POST /v1/me/phone-numbers/:id/verify',
  'POST /v1/me/sessions/:id/revoke',
  'POST /v1/me/sessions/revoke-others',
  'POST /v1/notifications/:id/act',
  'POST /v1/notifications/:id/cancel',
  'POST /v1/notifications/:id/send',
  'POST /v1/notifications/:id/test',
  'POST /v1/me/notifications/:id/act',
  'POST /v1/orgs/:orgId/cycles/:id/backfill',
  'POST /v1/orgs/:orgId/cycles/:id/close',
  'POST /v1/orgs/:orgId/integrations/:id/import',
  'POST /v1/orgs/:orgId/integrations/:id/notion/people/:externalId/resolve',
  'POST /v1/orgs/:orgId/integrations/:id/notion/provision',
  'POST /v1/orgs/:orgId/integrations/:id/notion/sync',
  'POST /v1/orgs/:orgId/integrations/:id/sync',
  'POST /v1/orgs/:orgId/integrations/:id/verify',
  'POST /v1/orgs/:orgId/integrations/mcp/:id/authorize',
  'POST /v1/orgs/:orgId/integrations/mcp/:id/verify',
  'POST /v1/orgs/:orgId/labels/:id/merge',
  'POST /v1/orgs/:orgId/mentions/hydrate',
  'POST /v1/orgs/:orgId/members/accept-invite',
  'POST /v1/orgs/:orgId/members/invitations/:token/accept',
  'POST /v1/orgs/:orgId/members/invite',
  'POST /v1/orgs/:orgId/publishing/domains/:id/verify',
  'POST /v1/orgs/:orgId/recurrence-series/:id/materialize',
  'POST /v1/orgs/:orgId/sessions/:id/cancel',
  'POST /v1/orgs/:orgId/sessions/:id/pause',
  'POST /v1/orgs/:orgId/sessions/:id/resume',
  'POST /v1/orgs/:orgId/sessions/:id/run',
  'POST /v1/orgs/:orgId/statuses/reorder',
  'POST /v1/orgs/:orgId/teams/:teamId/statuses/fork',
  'DELETE /v1/orgs/:orgId/teams/:teamId/statuses/fork',
  'GET /v1/orgs/:orgId/integrations/linear-agent/install',
  'POST /admin/impersonations/:id/end',
  'POST /admin/orgs/:id/extend-trial',
  'POST /admin/orgs/:id/reactivate',
];

/**
 * `PUT` routes to a non-member path that genuinely replace everything at that path.
 *
 * @remarks
 * Correct, not grandfathered. `PUT` replaces the resource identified by the request URI, and
 * for these the request URI *is* the whole resource: a singleton settings document, or the
 * complete allocation set for one time record. Sending a smaller set deletes the rest, which
 * is exactly what `PUT` promises.
 */
const WHOLE_RESOURCE_PUTS: readonly string[] = [
  'PUT /v1/schedule-week/preferences',
  'PUT /v1/time/records/:id/allocations',
];

/**
 * `PUT` routes that address a collection but write only one member of it.
 *
 * @remarks
 * Frozen, for the same reason as {@link LEGACY_ACTION_PATHS}. These upsert a single member
 * while claiming, by method and URI, to replace the entire collection — so a client cannot
 * tell from the contract that the other members survive. Each should move to
 * `PUT <collection>/:memberId`; `rest-conventions.md` §"Known exceptions" records the target.
 */
const LEGACY_MEMBER_UPSERT_PUTS: readonly string[] = [
  'PUT /v1/orgs/:orgId/grants',
  'PUT /v1/orgs/:orgId/teams/:teamId/members',
];

/**
 * Member writes whose resource is deliberately readable only through its parent.
 *
 * @remarks
 * Each of these patches a facet of a larger document that has no standalone representation of
 * its own — one calendar inside the calendar-settings payload, one link inside an initiative's
 * hierarchy, one proposal inside a session activity. The parent read returns the written state,
 * so the resource is not write-only; it simply is not separately addressable for reads.
 */
const PARENT_READ_ONLY_MEMBERS: readonly string[] = [
  'PATCH /v1/me/calendar/calendars/:id',
  'PATCH /v1/orgs/:orgId/initiatives/hierarchy-links/:linkId',
  'PATCH /v1/orgs/:orgId/sessions/:id/activity/:activityId/proposal',
  'PATCH /v1/me/athena/sessions/:id/activity/:activityId/proposal',
];

/** Segments that are path parameters rather than literals. */
function isParam(segment: string): boolean {
  return segment.startsWith(':');
}

let endpoints: Endpoint[];

beforeAll(async () => {
  const { app, adminApp } = await import('../../src/app');
  const seen = new Set<string>();
  endpoints = [];
  for (const [surface, instance] of [
    ['v1', app],
    ['admin', adminApp],
  ] as const) {
    for (const route of instance.routes) {
      // Hono lists one entry per middleware in a chain; only the routable pairs matter, and
      // `ALL`/wildcard entries are middleware registrations rather than endpoints.
      if (route.method === 'ALL' || route.path.includes('*')) continue;
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push({ surface, method: route.method, path: route.path });
    }
  }
});

describe('URL design', () => {
  it('names resources, not procedures', () => {
    const offenders = endpoints
      .filter((e) => {
        const last = e.path.split('/').filter(Boolean).at(-1);
        return last !== undefined && !isParam(last) && ACTION_VERBS.has(last);
      })
      .map((e) => `${e.method} ${e.path}`)
      .filter((key) => !LEGACY_ACTION_PATHS.includes(key));

    expect(offenders).toEqual([]);
  });

  it('keeps every action exception tied to a route that still exists', () => {
    const live = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
    const stale = LEGACY_ACTION_PATHS.filter((key) => !live.has(key));

    expect(stale).toEqual([]);
  });

  it('uses lower-kebab-case segments throughout', () => {
    const offenders = endpoints
      .filter((e) =>
        e.path
          .split('/')
          .filter(Boolean)
          .filter((s) => !isParam(s))
          .some((s) => !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(s)),
      )
      .map((e) => `${e.method} ${e.path}`);

    expect(offenders).toEqual([]);
  });

  it('never trails a slash, which would address a different resource than the bare path', () => {
    const offenders = endpoints
      .filter((e) => e.path.length > 1 && e.path.endsWith('/'))
      .map((e) => `${e.method} ${e.path}`);

    expect(offenders).toEqual([]);
  });
});

describe('method semantics', () => {
  it('sends PUT only to a member, a singleton, or a fully-replaced set', () => {
    const accounted = [...WHOLE_RESOURCE_PUTS, ...LEGACY_MEMBER_UPSERT_PUTS];
    const offenders = endpoints
      .filter((e) => e.method === 'PUT' && !isParam(e.path.split('/').filter(Boolean).at(-1) ?? ''))
      .map((e) => `${e.method} ${e.path}`)
      .filter((key) => !accounted.includes(key));

    expect(offenders).toEqual([]);
  });

  it('keeps every PUT classification tied to a route that still exists', () => {
    const live = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
    const stale = [...WHOLE_RESOURCE_PUTS, ...LEGACY_MEMBER_UPSERT_PUTS].filter(
      (key) => !live.has(key),
    );

    expect(stale).toEqual([]);
  });

  it('gives every member path a reader, so nothing is write-only', () => {
    const readable = new Set(endpoints.filter((e) => e.method === 'GET').map((e) => e.path));
    const orphans = endpoints
      .filter((e) => e.method === 'PATCH' || e.method === 'PUT')
      // A write implies the written state is readable — at the same address, or at the parent
      // whose representation contains it when the facet has no standalone URL of its own.
      .filter((e) => !readable.has(e.path) && !readable.has(e.path.replace(/\/[^/]+$/, '')))
      .map((e) => `${e.method} ${e.path}`)
      .filter((key) => !PARENT_READ_ONLY_MEMBERS.includes(key));

    expect(orphans).toEqual([]);
  });

  it('keeps every parent-read exception tied to a route that still exists', () => {
    const live = new Set(endpoints.map((e) => `${e.method} ${e.path}`));

    expect(PARENT_READ_ONLY_MEMBERS.filter((key) => !live.has(key))).toEqual([]);
  });
});
