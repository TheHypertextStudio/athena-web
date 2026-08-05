/**
 * `@docket/types` — the structured sources Docket can reference resources from.
 *
 * @remarks
 * One declarative registry, so supporting a new source is an entry here plus an adapter — never an
 * edit to URL matching, canonicalization, dedupe, unfurl routing, or any UI that renders a
 * provider. Everything downstream iterates this table rather than naming a provider.
 *
 * A provider is listed as soon as Docket can *recognize* its URLs, which is earlier than it can
 * search them. Recognition alone is worth having: a pasted SharePoint link is then labelled
 * "SharePoint", deduped by its real document id rather than by URL string, and reported as needing
 * a connection instead of being blind-fetched into a login page and titled "Sign in".
 */
import { z } from 'zod';

/** How a resource's metadata can be obtained. */
export type ResourceResolution =
  /** Fetchable over plain HTTP with no credential — the open web. */
  | 'public'
  /** Requires the viewer's own connected account; an anonymous fetch returns a sign-in page. */
  | 'credentialed';

/** The app-owned shape of a referenced resource, used to pick its glyph and label. */
export const ExternalResourceType = z.enum([
  'document',
  'spreadsheet',
  'presentation',
  'folder',
  'pdf',
  'image',
  'video',
  'file',
  'issue',
  'message',
  'event',
  'page',
  'unknown',
]);
/** External-resource-type value. */
export type ExternalResourceType = z.infer<typeof ExternalResourceType>;

/** One URL shape a provider owns, and what that shape implies the resource is. */
export interface ResourceUrlPattern {
  /**
   * Matched against the pathname, or against `pathname + search` when {@link includeSearch} is set.
   * Capture group 1 is the provider's own id for the resource.
   */
  readonly pattern: RegExp;
  /** What the URL shape says the resource is, before any API call confirms it. */
  readonly resourceType: ExternalResourceType;
  /** Set when the id lives in the query string rather than the path. */
  readonly includeSearch?: boolean;
}

/** Everything Docket knows about one structured source. */
export interface ResourceProviderDefinition {
  /** Stable id; matches the `resource_provider` database enum. */
  readonly id: ResourceProviderId;
  /** What Docket calls it on screen. Application-owned copy. */
  readonly label: string;
  /**
   * Hosts this provider owns.
   *
   * @remarks
   * Matched as an exact host or a dot-bounded suffix, so `sharepoint.com` matches
   * `contoso.sharepoint.com` but never `sharepoint.com.attacker.example`.
   */
  readonly hosts: readonly string[];
  /** URL shapes that identify a specific resource. */
  readonly patterns: readonly ResourceUrlPattern[];
  /** Whether metadata needs the viewer's own credential. */
  readonly resolution: ResourceResolution;
}

/**
 * Every source Docket recognizes.
 *
 * @remarks
 * `web` is deliberately absent: it is the fallback for a URL no provider claims, not a provider
 * with hosts of its own.
 */
export const RESOURCE_PROVIDERS: readonly ResourceProviderDefinition[] = [
  {
    id: 'google_drive',
    label: 'Drive',
    hosts: ['docs.google.com', 'drive.google.com'],
    patterns: [
      { pattern: /^\/document\/d\/([^/?#]+)/, resourceType: 'document' },
      { pattern: /^\/spreadsheets\/d\/([^/?#]+)/, resourceType: 'spreadsheet' },
      { pattern: /^\/presentation\/d\/([^/?#]+)/, resourceType: 'presentation' },
      { pattern: /^\/forms\/d\/([^/?#]+)/, resourceType: 'page' },
      { pattern: /^\/drawings\/d\/([^/?#]+)/, resourceType: 'image' },
      { pattern: /^\/file\/d\/([^/?#]+)/, resourceType: 'file' },
      { pattern: /^\/drive\/folders\/([^/?#]+)/, resourceType: 'folder' },
      // The legacy id-query shapes: /open?id=X and /uc?id=X.
      {
        pattern: /^\/(?:open|uc)\?(?:.*&)?id=([^&#]+)/,
        resourceType: 'unknown',
        includeSearch: true,
      },
    ],
    resolution: 'credentialed',
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    hosts: ['onedrive.live.com', '1drv.ms'],
    patterns: [
      { pattern: /^\/[^/]*\?(?:.*&)?resid=([^&#]+)/i, resourceType: 'file', includeSearch: true },
      // A 1drv.ms short link carries only an opaque token; it still identifies one resource.
      { pattern: /^\/([A-Za-z0-9!_-]{6,})$/, resourceType: 'file' },
    ],
    resolution: 'credentialed',
  },
  {
    id: 'sharepoint',
    label: 'SharePoint',
    hosts: ['sharepoint.com'],
    patterns: [
      // A share link is `/:w:/{g|r|s}/{personal|sites}/{tenant}/{docId}`, with the tenant segment
      // varying by deployment — the document id is reliably the final segment.
      { pattern: /^\/:[a-z]:\/[a-z]\/.*\/([^/?#]+)/i, resourceType: 'file' },
      { pattern: /^\/sites\/([^/?#]+)/i, resourceType: 'page' },
    ],
    resolution: 'credentialed',
  },
  {
    id: 'notion',
    label: 'Notion',
    hosts: ['notion.so', 'www.notion.so', 'notion.site'],
    patterns: [
      // A Notion page slug ends in its 32-character id, with or without dashes.
      { pattern: /^\/(?:[^/?#]*-)?([0-9a-f]{32})(?:[/?#]|$)/i, resourceType: 'page' },
      {
        pattern: /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        resourceType: 'page',
      },
    ],
    resolution: 'credentialed',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    hosts: ['dropbox.com', 'www.dropbox.com'],
    patterns: [{ pattern: /^\/(?:s|scl\/fi)\/([^/?#]+)/, resourceType: 'file' }],
    resolution: 'credentialed',
  },
  {
    id: 'box',
    label: 'Box',
    hosts: ['app.box.com', 'box.com'],
    patterns: [
      { pattern: /^\/s\/([^/?#]+)/, resourceType: 'file' },
      { pattern: /^\/file\/([^/?#]+)/, resourceType: 'file' },
      { pattern: /^\/folder\/([^/?#]+)/, resourceType: 'folder' },
    ],
    resolution: 'credentialed',
  },
  {
    id: 'figma',
    label: 'Figma',
    hosts: ['figma.com', 'www.figma.com'],
    patterns: [{ pattern: /^\/(?:file|design|board|slides)\/([^/?#]+)/, resourceType: 'image' }],
    resolution: 'credentialed',
  },
  {
    id: 'confluence',
    label: 'Confluence',
    hosts: ['atlassian.net'],
    patterns: [{ pattern: /^\/wiki\/spaces\/[^/]+\/pages\/([0-9]+)/, resourceType: 'page' }],
    resolution: 'credentialed',
  },
];

/**
 * Which system owns a resource.
 *
 * @remarks
 * Must stay in step with the `resource_provider` database enum; a test asserts the two agree, so
 * adding a provider without a migration fails loudly rather than at runtime.
 */
export const ResourceProvider = z.enum([
  'web',
  'google_drive',
  'onedrive',
  'sharepoint',
  'notion',
  'dropbox',
  'box',
  'figma',
  'confluence',
]);
/** Resource-provider value. */
export type ResourceProvider = z.infer<typeof ResourceProvider>;

/** A provider id, excluding the generic web fallback. */
export type ResourceProviderId = Exclude<ResourceProvider, 'web'>;

/** Provider labels by id, including the generic web fallback. */
export const RESOURCE_PROVIDER_LABEL: Readonly<Record<ResourceProvider, string>> = {
  web: 'Link',
  ...Object.fromEntries(RESOURCE_PROVIDERS.map((p) => [p.id, p.label])),
} as Record<ResourceProvider, string>;

/**
 * Whether a host belongs to a provider.
 *
 * @remarks
 * Exact match or dot-bounded suffix. The dot is what stops `sharepoint.com.attacker.example` from
 * being handed a viewer's SharePoint credential.
 */
function hostMatches(host: string, owned: string): boolean {
  return host === owned || host.endsWith(`.${owned}`);
}

/** Find the provider that owns a host, if any. */
export function providerForHost(host: string): ResourceProviderDefinition | undefined {
  const lower = host.toLowerCase();
  return RESOURCE_PROVIDERS.find((provider) =>
    provider.hosts.some((owned) => hostMatches(lower, owned)),
  );
}

/** Look up one provider by id. */
export function resourceProviderById(
  id: ResourceProviderId,
): ResourceProviderDefinition | undefined {
  return RESOURCE_PROVIDERS.find((provider) => provider.id === id);
}
