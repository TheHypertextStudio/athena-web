import type { PublicBriefOut } from '@docket/work/publish-contract';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { BriefDocument } from '@/components/publishing/brief-document';

import { briefMetadata, readBriefAt } from '../../shared';

/**
 * The published brief page on a workspace's own verified custom domain: the surface that lets a
 * workspace's verified custom domain actually serve its published briefs over HTTPS, reading live
 * from the same underlying records as the rest of the app (never a forked snapshot) and designed
 * as a standalone document rather than an app screen. See the sibling `[workspace]/[slug]/page.tsx`
 * for the shared-brief-host shape and the full rationale — this route exists only because a custom
 * domain needs no workspace segment: the host itself already belongs to exactly one workspace (a
 * domain can be claimed by only one, per the unique host index), so `/<slug>` alone is
 * unambiguous.
 *
 * `apps/web/src/proxy.ts` rewrites a request on any host that is neither the product's own nor
 * the configured shared brief host to this route's internal path. The API's `resolvePublication`
 * (`publish-brief.ts`) still decides, from the request's forwarded `Host`, whether that domain is
 * actually verified for some workspace — this route only changes which URL shape reaches that
 * check, never what it permits.
 */

/** See the sibling route's identical `dynamic` export for the full rationale. */
export const dynamic = 'force-dynamic';

/** The route's own params. */
interface DomainBriefParams {
  /** The brief's path segment. */
  readonly slug: string;
}

/** Read this route's brief from the host-only API path. */
async function readBrief(params: DomainBriefParams): Promise<PublicBriefOut | null> {
  return readBriefAt(`/v1/public/briefs/domain/${encodeURIComponent(params.slug)}`);
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
  params: Promise<DomainBriefParams>;
}): Promise<Metadata> {
  return briefMetadata(await readBrief(await params));
}

/**
 * Render one published brief for an anonymous visitor.
 *
 * @param props - The route params.
 * @returns The brief document.
 */
export default async function PublishedDomainBriefPage({
  params,
}: {
  params: Promise<DomainBriefParams>;
}): Promise<JSX.Element> {
  const brief = await readBrief(await params);
  if (!brief) notFound();
  return <BriefDocument brief={brief} />;
}
