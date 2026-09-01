/**
 * `@docket/api` — the anonymous brief read (mounted at `/v1/public`).
 *
 * @remarks
 * The only route in Docket that answers without a session, and it is deliberately mounted on
 * the root server **outside** the typed `/v1` app rather than inside it. The `/v1` app carries
 * `requireAuth` on `*`, which makes authentication opt-out for every route it contains; adding
 * a prefix exemption to that gate would weaken the one control that guarantees no `/v1` route is
 * accidentally public. Mounting outside means this router is structurally not in the
 * authenticated app at all — there is no exemption to get wrong, and the typed `AppType`
 * contract (and the public OpenAPI document generated from it) keeps its property that every
 * documented endpoint requires a session.
 *
 * It is a *read* of already-public data, and it is narrow: one path shape, no body, no
 * mutation, no enumeration. Everything it will serve was made public by a deliberate
 * `contribute`-gated act in the owning workspace, and every refusal is the same 404 so a visitor
 * cannot probe for what exists.
 *
 * @see {@link ./publish-brief} for the live projection and every refusal rule.
 */
import { PublicBriefOut } from '@docket/work/publish-contract';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { zParam, zQuery } from '../lib/validate';
import { loadPublicBrief } from './publish-brief';

/** The workspace's own identity slug and the brief slug that identify one brief. */
const briefParam = z.object({ workspaceSlug: z.string(), slug: z.string() });

/** The brief slug alone, for a request whose `Host` already identifies the workspace. */
const domainBriefParam = z.object({ slug: z.string() });

/**
 * The host the visitor's browser actually asked on.
 *
 * @remarks
 * Passed explicitly rather than read from this request's own `Host` header, because the reader
 * is a Next.js server component: by the time the request reaches the API it has been through a
 * reverse proxy that rewrote `Host` to the API's own name, so the API cannot observe the
 * visitor's host. Getting it wrong in the permissive direction would let a custom domain serve
 * another workspace's briefs, so it is required to be explicit, and omitting it means "Docket's
 * own host" rather than "any host".
 *
 * A hostname is not personal data, which is why it is acceptable in a query string.
 */
const briefQuery = z.object({ host: z.string().max(253).optional() });

/**
 * Deliberately uncacheable, including by shared caches. Every response here embeds two decisions
 * that can be revoked at any moment: that this record is published at all, and that this host may
 * serve this workspace. A cache stores the decision along with the bytes, so any positive TTL is
 * a window in which a withdrawn brief — or a brief on a domain that has just been released —
 * keeps being served to the public. That window was measured at 60 seconds before this header
 * existed, with all three entity types still answering 200 in a clean browser after being
 * unpublished.
 */
function noStore(c: { header: (name: string, value: string) => void }): void {
  c.header('Cache-Control', 'no-store');
}

/** The public brief router: two reads (shared host, custom domain), no session, no mutation. */
const publicBriefs = new Hono<AppEnv>()
  .get('/briefs/:workspaceSlug/:slug', zParam(briefParam), zQuery(briefQuery), async (c) => {
    const { workspaceSlug, slug } = c.req.valid('param');
    const { host } = c.req.valid('query');
    const brief = await loadPublicBrief({ host, workspaceSlug, slug });
    noStore(c);
    return ok(c, PublicBriefOut, brief);
  })
  .get('/briefs/domain/:slug', zParam(domainBriefParam), zQuery(briefQuery), async (c) => {
    const { slug } = c.req.valid('param');
    const { host } = c.req.valid('query');
    const brief = await loadPublicBrief({ host, workspaceSlug: undefined, slug });
    noStore(c);
    return ok(c, PublicBriefOut, brief);
  });

export default publicBriefs;
