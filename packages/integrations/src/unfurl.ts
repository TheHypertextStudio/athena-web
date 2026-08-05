/**
 * Resolve display metadata for an arbitrary URL, so a pasted link is never just a link.
 *
 * @remarks
 * This is the one place in the product where an authenticated user makes the server fetch a URL of
 * their choosing, so it runs entirely through {@link safeOutboundFetch} — HTTPS only, no private or
 * link-local address, connect-time address pinning, per-hop redirect re-validation, and hard bounds
 * on time and bytes. It never sends credentials, and it never carries a provider token: a URL that
 * a connected provider owns takes the provider's own API instead, upstream of here.
 *
 * Parsing is a bounded scan of `<head>` written by hand rather than a DOM library, matching the
 * dependency-light shape of the rest of this package's HTTP edge. Everything a preview needs is
 * declared in the head; the body is not read.
 */
import type { ExternalResourceType } from '@docket/types';

import { createSafeOutboundFetch } from './safe-fetch';
import type { safeOutboundFetch, SafeNetworkLimits } from './safe-fetch';

/** Metadata resolved for one URL. */
export interface UnfurlMetadata {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly siteName: string | undefined;
  readonly iconUrl: string | undefined;
  readonly thumbnailUrl: string | undefined;
  readonly resourceType: ExternalResourceType;
}

/** What became of an unfurl attempt. */
export type UnfurlOutcome =
  | { readonly status: 'ok'; readonly metadata: UnfurlMetadata }
  /** The URL is not something we will fetch at all — wrong scheme, or a body we refuse to parse. */
  | { readonly status: 'unsupported' }
  /** The fetch was attempted and did not produce usable metadata. Retryable. */
  | { readonly status: 'failed'; readonly reason: string };

/** The outbound boundary an unfurler fetches through. */
export interface Unfurler {
  unfurl(url: string): Promise<UnfurlOutcome>;
}

/**
 * Bounds tighter than the MCP defaults.
 *
 * @remarks
 * An unfurl is a background nicety on a page the user is already looking at, so it must never
 * become a way to tie up a request slot. Four seconds total is generous for a `<head>`.
 */
const UNFURL_LIMITS: SafeNetworkLimits = {
  maxRedirects: 3,
  connectTimeoutMs: 2_000,
  overallTimeoutMs: 4_000,
  maxHeaderBytes: 16 * 1024,
  maxBodyBytes: 512 * 1024,
};

/** Content types worth parsing. Anything else is described from its headers, not opened. */
const PARSEABLE = ['text/html', 'application/xhtml+xml'];

/** Read one HTML attribute out of a tag, tolerating single, double, and unquoted values. */
function attr(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = pattern.exec(tag);
  if (!match) return undefined;
  const value = match[2] ?? match[3] ?? match[4];
  return value === undefined || value === '' ? undefined : decodeEntities(value);
}

/** Decode the handful of entities that actually show up in titles and descriptions. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/** Resolve a possibly-relative URL against the page it was found on, dropping anything unsafe. */
function absolute(href: string | undefined, base: string): string | undefined {
  if (href === undefined) return undefined;
  try {
    const resolved = new URL(href, base);
    // Only https survives. An http or data icon URL would be loaded by the *reader's* browser,
    // so a permissive rule here becomes mixed content or a tracking pixel on every render.
    return resolved.protocol === 'https:' ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Map an OpenGraph `og:type` onto Docket's own taxonomy. */
function typeForOgType(ogType: string | undefined): ExternalResourceType {
  if (ogType === undefined) return 'page';
  if (ogType.startsWith('video')) return 'video';
  if (ogType.startsWith('image')) return 'image';
  if (ogType === 'article' || ogType === 'website') return 'page';
  return 'page';
}

/**
 * Extract display metadata from an HTML head.
 *
 * @remarks
 * Pure, so the whole extraction story is testable from fixture strings with no network at all.
 * Precedence per field is OpenGraph, then Twitter card, then the plain HTML element, because that
 * is the order of increasing genericness: `og:title` is what a publisher chose to be shared as,
 * and `<title>` is often padded with the site name.
 *
 * @param html - Response text; only the part up to `</head>` is examined.
 * @param finalUrl - The URL after redirects, used to resolve relative icons.
 * @returns The metadata, with absent fields left undefined rather than guessed.
 *
 * @example
 * ```typescript
 * parseHeadMetadata('<head><meta property="og:title" content="Plan"></head>', 'https://x/');
 * // { title: 'Plan', ... }
 * ```
 */
export function parseHeadMetadata(html: string, finalUrl: string): UnfurlMetadata {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html.slice(0, 128 * 1024) : html.slice(0, headEnd);

  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const byKey = new Map<string, string>();
  for (const tag of metas) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (key !== undefined && content !== undefined && !byKey.has(key)) byKey.set(key, content);
  }

  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  let iconHref: string | undefined;
  for (const tag of links) {
    const rel = attr(tag, 'rel')?.toLowerCase();
    if (rel === undefined) continue;
    const rels = rel.split(/\s+/);
    if (rels.includes('icon') || rels.includes('shortcut') || rels.includes('apple-touch-icon')) {
      iconHref ??= attr(tag, 'href');
    }
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const documentTitle = titleTag?.[1] === undefined ? undefined : decodeEntities(titleTag[1]);

  const title = byKey.get('og:title') ?? byKey.get('twitter:title') ?? documentTitle;
  const description =
    byKey.get('og:description') ?? byKey.get('twitter:description') ?? byKey.get('description');
  const image = byKey.get('og:image') ?? byKey.get('twitter:image');

  return {
    title: title === '' ? undefined : title,
    description: description === '' ? undefined : description,
    siteName: byKey.get('og:site_name') ?? new URL(finalUrl).hostname,
    // Fall back to the conventional location so a site with no declared icon still gets a glyph.
    iconUrl: absolute(iconHref, finalUrl) ?? absolute('/favicon.ico', finalUrl),
    thumbnailUrl: absolute(image, finalUrl),
    resourceType: typeForOgType(byKey.get('og:type')),
  };
}

/** Describe a resource we fetched but will not parse, from what its headers already told us. */
function metadataFromHeaders(finalUrl: string, contentType: string): UnfurlMetadata {
  const url = new URL(finalUrl);
  const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
  const type: ExternalResourceType = contentType.startsWith('image/')
    ? 'image'
    : contentType.startsWith('video/')
      ? 'video'
      : contentType === 'application/pdf'
        ? 'pdf'
        : 'file';
  return {
    // Derived from the URL we actually reached, not invented: a filename is a real fact about it.
    title: lastSegment === undefined ? undefined : decodeURIComponent(lastSegment),
    description: undefined,
    siteName: url.hostname,
    iconUrl: absolute('/favicon.ico', finalUrl),
    thumbnailUrl: undefined,
    resourceType: type,
  };
}

/** Fetches real URLs through the hardened boundary. */
export class RealUnfurler implements Unfurler {
  readonly #fetch: typeof safeOutboundFetch;

  /**
   * @param fetchImpl - Overridable only so tests can inject a transport; production always gets
   * the hardened boundary, bounded by {@link UNFURL_LIMITS}.
   */
  constructor(
    fetchImpl: typeof safeOutboundFetch = createSafeOutboundFetch({ limits: UNFURL_LIMITS }),
  ) {
    this.#fetch = fetchImpl;
  }

  async unfurl(url: string): Promise<UnfurlOutcome> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: 'unsupported' };
    }
    // http:// is refused rather than upgraded. Fetching it would leak the request in cleartext,
    // and guessing at https would attribute metadata to a URL nobody wrote.
    if (parsed.protocol !== 'https:') return { status: 'unsupported' };

    try {
      const response = await this.#fetch(parsed, {
        method: 'GET',
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) return { status: 'failed', reason: `http_${response.status}` };

      const finalUrl = response.url === '' ? parsed.toString() : response.url;
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
      if (!PARSEABLE.includes(contentType)) {
        return { status: 'ok', metadata: metadataFromHeaders(finalUrl, contentType) };
      }
      return { status: 'ok', metadata: parseHeadMetadata(await response.text(), finalUrl) };
    } catch (err) {
      return { status: 'failed', reason: err instanceof Error ? err.name : 'unknown' };
    }
  }
}

/** Deterministic fixture unfurler so the build and tests need no outbound network. */
export class MockUnfurler implements Unfurler {
  async unfurl(url: string): Promise<UnfurlOutcome> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: 'unsupported' };
    }
    if (parsed.protocol !== 'https:') return { status: 'unsupported' };
    const slug = parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.hostname;
    return Promise.resolve({
      status: 'ok',
      metadata: {
        title: `${slug.replace(/[-_]/g, ' ')} (${parsed.hostname})`,
        description: undefined,
        siteName: parsed.hostname,
        iconUrl: `https://${parsed.hostname}/favicon.ico`,
        thumbnailUrl: undefined,
        resourceType: 'page',
      },
    });
  }
}
