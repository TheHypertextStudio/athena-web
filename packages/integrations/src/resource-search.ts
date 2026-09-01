/**
 * The optional connector capability for searching a source's resources.
 *
 * @remarks
 * Sits alongside `WritableConnector`, `MailActions`, and `WorkGraphConnector` as a fourth `asX()`
 * capability, so a source that can be searched declares it structurally and every source that
 * cannot is simply absent — no flag, no stub throwing "not implemented".
 *
 * Nothing here mentions a specific product. Adding OneDrive, Notion, or SharePoint means one client
 * implementing this interface, one entry in the manifest below, and one fixture block; the fan-out,
 * the deadline, the dedupe, and the UI are untouched.
 */
import type {
  ExternalResourceType,
  ResourceProviderId,
} from '@docket/connections/resource-provider-contract';

/** One resource as a source describes it. */
export interface ExternalResource {
  /** Which source owns it. */
  readonly provider: ResourceProviderId;
  /** The source's own id for it, which is what Docket dedupes on. */
  readonly externalId: string;
  /** Docket's own taxonomy, mapped by the adapter — never a raw provider MIME type. */
  readonly resourceType: ExternalResourceType;
  readonly title: string;
  /** Where a person opens it. */
  readonly url: string;
  readonly mimeType?: string;
  readonly iconUrl?: string;
  readonly description?: string;
  /** Display name of whoever owns it at the source. */
  readonly ownerLabel?: string;
  /** RFC 3339. Absent when the source does not report one — never a fabricated date. */
  readonly modifiedAt?: string;
  /** The containing drive, site, or workspace, when the source has that concept. */
  readonly containerLabel?: string;
}

/** What a search asks a source for. */
export interface ResourceSearchInput {
  /** The integration whose credential funds the call. */
  readonly connectionId: string;
  /** What the user typed; empty asks the source for its own recents. */
  readonly query: string;
  /** How many results to return. */
  readonly limit: number;
  /** Deadline propagation, so an abandoned keystroke stops costing anything. */
  readonly signal?: AbortSignal;
}

/** One page of results. */
export interface ResourceSearchPage {
  readonly resources: readonly ExternalResource[];
  /**
   * True when the source returned a full page.
   *
   * @remarks
   * Load-bearing for prefix caching: a truncated page cannot be safely narrowed client-side,
   * because a longer query may legitimately match rows the shorter one never returned.
   */
  readonly truncated: boolean;
}

/** Resolve one already-identified resource, for unfurling a pasted link. */
export interface ResolveResourceInput {
  readonly externalId: string;
  readonly signal?: AbortSignal;
}

/** The capability a searchable source implements. */
export interface ResourceSearch {
  searchResources(input: ResourceSearchInput): Promise<ResourceSearchPage>;
  resolveResource(input: ResolveResourceInput): Promise<ExternalResource | undefined>;
}

/**
 * Sources with a working search adapter today.
 *
 * @remarks
 * Deliberately narrower than the URL registry in `domain packages`: Docket recognizes many sources'
 * links, and can search the ones listed here. `capability-manifest.test.ts` asserts this set and
 * the structural shape of each client agree, so a half-wired adapter fails a test rather than
 * silently returning nothing at runtime.
 */
export const RESOURCE_SEARCH_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set<string>(['drive']);

/** Whether a client implements the resource-search capability. */
export function isResourceSearchClient(client: object): client is ResourceSearch {
  return 'searchResources' in client && 'resolveResource' in client;
}
