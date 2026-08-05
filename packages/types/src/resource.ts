/**
 * `@docket/types` — external resource DTOs and the pure URL identity rules behind them.
 *
 * @remarks
 * An external resource is something outside Docket that a person has pointed at: a Drive file, a
 * web page. Docket holds a metadata snapshot so a reference can render as a real preview instead
 * of a bare link, and dedupes those snapshots per organization by a canonical key.
 *
 * The canonicalization is pure because two independent paths must agree on it exactly: the
 * reconciler deriving a key from prose, and the unfurler deriving one from a pasted URL. If they
 * disagree, one document becomes two rows with two different titles.
 */
import { z } from 'zod';

import { ExternalResourceId, OrganizationId } from './primitives';
import { ExternalResourceType, ResourceProvider, providerForHost } from './resource-provider';
import type { ResourceProviderId } from './resource-provider';

export {
  ExternalResourceType,
  RESOURCE_PROVIDER_LABEL,
  RESOURCE_PROVIDERS,
  ResourceProvider,
  providerForHost,
  resourceProviderById,
  type ResourceProviderDefinition,
  type ResourceProviderId,
  type ResourceResolution,
  type ResourceUrlPattern,
} from './resource-provider';

/** How far metadata resolution got for one resource. */
export const ResourceUnfurlStatus = z.enum([
  'pending',
  'ok',
  'forbidden',
  'requires_connection',
  'unsupported',
  'failed',
]);
/** Resource-unfurl-status value. */
export type ResourceUnfurlStatus = z.infer<typeof ResourceUnfurlStatus>;

/**
 * Everything a preview renders for one referenced resource.
 *
 * @remarks
 * Every field is nullable rather than optional, and a consumer must treat null as "we do not know"
 * and render nothing — never a placeholder, an em dash, or "Unknown owner". A thin resource shows
 * a glyph, a title, and a provider, and that is a complete, honest card.
 */
export const ExternalResourceOut = z
  .object({
    id: ExternalResourceId.describe('Opaque external-resource id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    provider: ResourceProvider.describe(
      "Which system owns the resource: 'google_drive', or 'web' for a generic unfurled page.",
    ),
    canonicalKey: z
      .string()
      .describe(
        'Stable dedupe identity within the org — `google_drive:<fileId>` or `web:<hash of the normalized URL>`.',
      ),
    canonicalUrl: z.string().describe('The normalized URL the resource lives at.'),
    externalId: z
      .string()
      .nullable()
      .describe("The provider's own id for the resource; null for generic web pages."),
    resourceType: ExternalResourceType.describe(
      "What kind of thing it is, in Docket's own vocabulary; 'unknown' until an unfurl resolves it.",
    ),
    title: z
      .string()
      .nullable()
      .describe(
        'Resolved title; null while the unfurl is pending or was refused. Never the URL as a stand-in.',
      ),
    description: z
      .string()
      .nullable()
      .describe('Short summary or meta description; null when none.'),
    siteName: z
      .string()
      .nullable()
      .describe('Publisher or app name (e.g. `Google Docs`); null when none.'),
    iconUrl: z
      .string()
      .nullable()
      .describe(
        'Favicon or file-type icon URL, served through the API image proxy; null when none.',
      ),
    thumbnailUrl: z.string().nullable().describe('Preview image URL; null when none.'),
    mimeType: z
      .string()
      .nullable()
      .describe('Provider MIME type when one is known; null otherwise.'),
    ownerLabel: z
      .string()
      .nullable()
      .describe("Display name of the resource's owner; null when unknown."),
    externalUpdatedAt: z
      .string()
      .nullable()
      .describe('When the resource last changed at the provider (ISO 8601); null when unreported.'),
    unfurlStatus: ResourceUnfurlStatus.describe(
      'How far metadata resolution got. Drives whether a card shows content, a pending state, or a reconnect prompt.',
    ),
    fetchedAt: z
      .string()
      .nullable()
      .describe('When the metadata was last fetched (ISO 8601); null while never fetched.'),
  })
  .meta({ id: 'ExternalResourceOut', description: 'A referenced resource outside Docket.' });
/** External-resource representation value. */
export type ExternalResourceOut = z.infer<typeof ExternalResourceOut>;

/** Query parameters that scope a URL unfurl request. */
export const ResourceUnfurlIn = z
  .object({
    url: z
      .url()
      .max(2048)
      .describe(
        'The absolute URL to resolve metadata for. Must be `https:`; anything else is unsupported.',
      ),
  })
  .meta({ id: 'ResourceUnfurlIn', description: 'A request to resolve metadata for a URL.' });
/** Validated unfurl-request body. */
export type ResourceUnfurlIn = z.infer<typeof ResourceUnfurlIn>;

/** Tracking parameters stripped during URL normalization because they never identify the resource. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'si',
  'usp',
]);

/**
 * Reduce a URL to a stable comparable form.
 *
 * @remarks
 * Drops the fragment, removes tracking parameters, sorts what remains, and strips a lone trailing
 * slash — on top of the scheme-case, host-case, and default-port normalization the URL parser has
 * already done. Deliberately conservative beyond that: path case is preserved because many hosts
 * are case-sensitive, and non-tracking query parameters are kept because they routinely select the
 * resource.
 *
 * @param raw - An absolute URL string.
 * @returns The normalized URL, or undefined when `raw` is not a parseable http(s) URL.
 *
 * @example
 * ```typescript
 * normalizeResourceUrl('HTTPS://Example.com:443/a/?utm_source=x&id=7#frag');
 * // 'https://example.com/a?id=7'
 * ```
 */
export function normalizeResourceUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  // Scheme case, host case, and the default port are already normalized by the URL parser;
  // only the fragment, the tracking parameters, and the trailing slash are ours to remove.
  url.hash = '';

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/** A URL recognized as belonging to a structured source. */
export interface ProviderResourceMatch {
  /** The provider that owns the resource. */
  readonly provider: ResourceProviderId;
  /** The provider's own id for the resource. */
  readonly externalId: string;
  /** The resource shape implied by the URL, before any API call confirms it. */
  readonly resourceType: ExternalResourceType;
}

/**
 * Recognize a URL that belongs to a structured source.
 *
 * @remarks
 * Pure and credential-free, so it runs before any token is resolved and is table-testable with no
 * network. It walks {@link RESOURCE_PROVIDERS} rather than naming a provider, so supporting a new
 * source never touches this function.
 *
 * Matching matters for correctness, not only for speed: an anonymous fetch of a Drive, SharePoint,
 * or Notion URL returns that product's sign-in page, so without recognition every such link would
 * unfurl with a title like "Sign in".
 *
 * Host comparison is exact or dot-bounded, so a lookalike like `docs.google.com.attacker.example`
 * never matches and never gets handed a viewer's credential.
 *
 * @param raw - An absolute URL string.
 * @returns The matched provider and id, or undefined for anything we treat as an ordinary page.
 *
 * @example
 * ```typescript
 * matchProviderResourceUrl('https://docs.google.com/document/d/abc123/edit');
 * // { provider: 'google_drive', externalId: 'abc123', resourceType: 'document' }
 * ```
 */
export function matchProviderResourceUrl(raw: string): ProviderResourceMatch | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  // https only: a downgraded link must never be treated as belonging to a credentialed source.
  if (url.protocol !== 'https:') return undefined;

  const provider = providerForHost(url.hostname);
  if (provider === undefined) return undefined;

  for (const { pattern, resourceType, includeSearch } of provider.patterns) {
    const target = includeSearch === true ? `${url.pathname}${url.search}` : url.pathname;
    const externalId = pattern.exec(target)?.[1];
    if (externalId !== undefined && externalId !== '') {
      return { provider: provider.id, externalId, resourceType };
    }
  }
  return undefined;
}

/**
 * Build the per-org dedupe key for a provider-owned resource.
 *
 * @param provider - The owning provider.
 * @param externalId - The provider's own id for the resource.
 * @returns The canonical key, e.g. `google_drive:1AbC`.
 */
export function providerResourceKey(
  provider: Exclude<ResourceProvider, 'web'>,
  externalId: string,
): string {
  return `${provider}:${externalId}`;
}

/**
 * Build the per-org dedupe key for a generic web page.
 *
 * @remarks
 * Uses the normalized URL directly rather than a hash. A hash would buy a fixed key length at the
 * cost of making every stored key unreadable in a query result, and the column is unbounded text
 * either way.
 *
 * @param normalizedUrl - Output of {@link normalizeResourceUrl}.
 * @returns The canonical key, e.g. `web:https://example.com/a`.
 */
export function webResourceKey(normalizedUrl: string): string {
  return `web:${normalizedUrl}`;
}

/**
 * Derive the canonical key and provider for any URL.
 *
 * @param raw - An absolute URL string.
 * @returns The identity to dedupe on, or undefined when the URL is not one we can reference.
 *
 * @example
 * ```typescript
 * canonicalizeResourceUrl('https://drive.google.com/file/d/X/view?usp=sharing');
 * // { provider: 'google_drive', canonicalKey: 'google_drive:X', canonicalUrl: 'https://drive.google.com/file/d/X/view', externalId: 'X', resourceType: 'file' }
 * ```
 */
export function canonicalizeResourceUrl(raw: string):
  | {
      readonly provider: ResourceProvider;
      readonly canonicalKey: string;
      readonly canonicalUrl: string;
      readonly externalId: string | undefined;
      readonly resourceType: ExternalResourceType;
    }
  | undefined {
  const normalized = normalizeResourceUrl(raw);
  if (normalized === undefined) return undefined;

  const match = matchProviderResourceUrl(raw);
  if (match !== undefined) {
    return {
      provider: match.provider,
      canonicalKey: providerResourceKey(match.provider, match.externalId),
      canonicalUrl: normalized,
      externalId: match.externalId,
      resourceType: match.resourceType,
    };
  }
  return {
    provider: 'web',
    canonicalKey: webResourceKey(normalized),
    canonicalUrl: normalized,
    externalId: undefined,
    resourceType: 'unknown',
  };
}
