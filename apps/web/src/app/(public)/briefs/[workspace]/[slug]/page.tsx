import type { PublicBriefOut } from '@docket/types';
import { env } from '@docket/env/web';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { BriefDocument } from '@/components/publishing/brief-document';

/**
 * The published brief page (CORE-26, CORE-27, CORE-33, MISS-04).
 *
 * @remarks
 * One canonical path shape, `/briefs/<workspace>/<slug>`, served identically on Docket's own
 * brief host and on a workspace's verified custom domain. Keeping one shape rather than adding
 * a bare `/<slug>` on custom domains is deliberate: a root-level catch-all in the App Router
 * would sit alongside the marketing routes and swallow any path they do not claim, which is a
 * routing hazard that grows every time a marketing page is added. The host still decides *which*
 * workspace may be served — the API refuses a brief that does not belong to the domain's owner —
 * so the isolation property MISS-04 asks for is enforced regardless of the path shape.
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
  /** The publishing workspace's claimed public name. */
  readonly workspace: string;
  /** The brief's path segment. */
  readonly slug: string;
}

/**
 * The host the visitor's browser actually asked on.
 *
 * @remarks
 * Forwarded to the API explicitly because the API sits behind this app's rewrite proxy and
 * cannot observe it. `x-forwarded-host` wins over `host`: behind a proxy the latter is the
 * proxy's own name, and using it would make every custom-domain request look like a request to
 * Docket's own host — the permissive direction, which is exactly the direction that must not be
 * guessed.
 */
async function visitorHost(): Promise<string | undefined> {
  const store = await headers();
  const raw = store.get('x-forwarded-host') ?? store.get('host');
  if (raw === null || raw.length === 0) return undefined;
  return raw.split(',')[0]?.trim();
}

/**
 * Read one published brief, or `null` when it is not published, not found, or not permitted
 * on this host.
 *
 * @remarks
 * Every one of those cases is a 404 from the API and `null` here, for the same reason it is one
 * status there: a visitor must not be able to tell an unpublished brief from a nonexistent one.
 */
async function readBrief(params: BriefParams): Promise<PublicBriefOut | null> {
  const apiOrigin = env.NEXT_PUBLIC_API_URL;
  const host = await visitorHost();
  const url = new URL(
    `/v1/public/briefs/${encodeURIComponent(params.workspace)}/${encodeURIComponent(params.slug)}`,
    apiOrigin,
  );
  if (host !== undefined) url.searchParams.set('host', host);

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    // Same reason as `dynamic` above: a cached read is a cached authorization decision.
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as PublicBriefOut;
}

/**
 * Page metadata read from the same live record the body renders.
 *
 * @remarks
 * `robots` is left at the default (indexable) because the whole point of publishing is to be
 * readable on the web; nothing here is gated. The description falls back to the workspace name
 * rather than being omitted, so a link preview never renders as a bare URL.
 *
 * @param props - The route params.
 * @returns The document metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<BriefParams>;
}): Promise<Metadata> {
  const brief = await readBrief(await params);
  if (!brief) return { title: 'Brief not found' };
  return {
    title: `${brief.title} — ${brief.workspaceName}`,
    description: brief.summary ?? `A brief published by ${brief.workspaceName}.`,
    ...(brief.canonicalUrl ? { alternates: { canonical: brief.canonicalUrl } } : {}),
    openGraph: {
      type: 'article',
      title: brief.title,
      ...(brief.summary ? { description: brief.summary } : {}),
      siteName: brief.workspaceName,
      publishedTime: brief.publishedAt,
      modifiedTime: brief.updatedAt,
    },
  };
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
