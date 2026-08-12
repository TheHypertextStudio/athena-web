/**
 * `apps/web` — shared read + metadata logic for both public brief page shapes.
 *
 * @remarks
 * `[workspace]/[slug]/page.tsx` (the shared brief host, where a workspace segment disambiguates)
 * and `domain/[slug]/page.tsx` (a verified custom domain, where the host alone already identifies
 * the workspace) differ only in which internal API path they read. Everything else — forwarding
 * the visitor's real host, refusing to cache an authorization decision, and building metadata from
 * the same live document the page renders — is identical, so it lives here once.
 */
import type { PublicBriefOut } from '@docket/types';
import { env } from '@docket/env/web';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

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
export async function visitorHost(): Promise<string | undefined> {
  const store = await headers();
  const raw = store.get('x-forwarded-host') ?? store.get('host');
  if (raw === null || raw.length === 0) return undefined;
  return raw.split(',')[0]?.trim();
}

/**
 * Read one published brief from the given internal API path, or `null` when it is not published,
 * not found, or not permitted on this host.
 *
 * @remarks
 * Every one of those cases is a 404 from the API and `null` here, for the same reason it is one
 * status there: a visitor must not be able to tell an unpublished brief from a nonexistent one.
 * Deliberately uncached: whether a brief may be read is an authorization decision, and a cached
 * "yes" would keep answering after a workspace unpublishes it.
 *
 * @param apiPath - The `/v1/public/briefs/...` path identifying the brief, already encoded.
 * @returns The brief document, or `null`.
 */
export async function readBriefAt(apiPath: string): Promise<PublicBriefOut | null> {
  const apiOrigin = env.NEXT_PUBLIC_API_URL;
  const host = await visitorHost();
  const url = new URL(apiPath, apiOrigin);
  if (host !== undefined) url.searchParams.set('host', host);

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as PublicBriefOut;
}

/**
 * Page metadata read from the same live document the page body renders.
 *
 * @remarks
 * `robots` is left at the default (indexable) because the whole point of publishing is to be
 * readable on the web; nothing here is gated. The description falls back to the workspace name
 * rather than being omitted, so a link preview never renders as a bare URL.
 *
 * @param brief - The brief this page resolved, or `null` when it could not be read.
 * @returns The document metadata.
 */
export function briefMetadata(brief: PublicBriefOut | null): Metadata {
  if (!brief) return { title: 'Page not found' };
  return {
    title: `${brief.title} — ${brief.workspaceName}`,
    description: brief.summary ?? `A public update from ${brief.workspaceName}.`,
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
