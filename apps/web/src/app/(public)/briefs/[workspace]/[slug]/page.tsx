import type { PublicBriefOut } from '@docket/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { BriefDocument } from '@/components/publishing/brief-document';

import { briefMetadata, readBriefAt } from '../../shared';

/**
 * The published brief page on the shared brief host: the surface that lets a published
 * initiative, program, or project be reached as a public brief. It reads live from the same
 * underlying records as the rest of the app rather than a forked snapshot, is designed as a
 * standalone document rather than an app screen, and — together with the custom-domain variant —
 * is what a workspace's verified custom domain actually serves over HTTPS.
 *
 * @remarks
 * Internally, one canonical path shape: `/briefs/<workspace>/<slug>`. A bare `/<workspace>/<slug>`
 * at the App Router's root was rejected here for the same reason it still is: it would sit
 * alongside the marketing routes and swallow any path they do not claim, a routing hazard that
 * grows every time a marketing page is added.
 *
 * A visitor never sees the `/briefs/` segment, though — `apps/web/src/proxy.ts` rewrites the
 * short public address to this route's internal path before Next resolves it, but only for
 * requests arriving on a host other than the product's own. The app's real routes are only ever
 * requested on its own canonical host, so that rewrite can never reach them, and this route keeps
 * its one internal shape either way.
 *
 * `<workspace>` is the publishing workspace's own identity slug — every workspace has one from
 * the moment it exists, so there is no "unclaimed" state to handle here. A verified custom domain
 * uses the sibling `domain/[slug]/page.tsx` route instead, since the host alone already identifies
 * the workspace and a workspace segment there would be redundant.
 *
 * The read is a plain server-side `fetch` rather than the app's typed RPC client, because the
 * brief endpoint deliberately lives outside the authenticated `/v1` app (see the API's
 * `publish-public.ts`) and therefore outside `AppType`. Nothing about the request is
 * session-derived: no cookie is forwarded, and none is needed.
 */

/**
 * A brief is rendered per request; nothing about it is cached.
 *
 * @remarks
 * This started as `revalidate = 60`, and a browser check caught what that actually meant:
 * after clicking Unpublish, all three briefs kept answering **200 with their full content** to a
 * brand-new incognito context, because the cached render outlived the decision that made them
 * public. "Unpublish" that leaves the page up for another minute is not unpublish.
 *
 * Whether a brief may be read is an authorization decision, and an authorization decision cannot
 * be cached without becoming wrong the moment it changes. The cost is one database round trip
 * per view of a page that is deliberately small; the alternative is a product that tells someone
 * their work is private while it is still being served.
 */
export const dynamic = 'force-dynamic';

/** The route's own params. */
interface BriefParams {
  /** The publishing workspace's own identity slug. */
  readonly workspace: string;
  /** The brief's path segment. */
  readonly slug: string;
}

/** Read this route's brief from the shared-brief-host API path. */
async function readBrief(params: BriefParams): Promise<PublicBriefOut | null> {
  return readBriefAt(
    `/v1/public/briefs/${encodeURIComponent(params.workspace)}/${encodeURIComponent(params.slug)}`,
  );
}

/**
 * Page metadata read from the same live record the body renders.
 *
 * @param props - The route params.
 * @returns The document metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<BriefParams>;
}): Promise<Metadata> {
  return briefMetadata(await readBrief(await params));
}

/**
 * Render one published brief for an anonymous visitor.
 *
 * @param props - The route params.
 * @returns The brief document.
 */
export default async function PublishedBriefPage({
  params,
}: {
  params: Promise<BriefParams>;
}): Promise<JSX.Element> {
  const brief = await readBrief(await params);
  if (!brief) notFound();
  return <BriefDocument brief={brief} />;
}
