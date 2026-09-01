/**
 * `@docket/auth` — the Google Workspace group-membership lookup behind operator SSO.
 *
 * @remarks
 * Google's OIDC ID token carries no group claims, so a Workspace group can only reach Docket
 * through an API call. This module is that call, expressed as a port so the sync logic is
 * testable without a network and so local development runs against a fixture.
 *
 * The real adapter reads the **Cloud Identity Groups API**, chosen over the Admin SDK Directory
 * API because the Cloud Run runtime service account can be granted read access through an
 * ordinary org-level IAM binding (`roles/cloudidentity.groupsReader`) — there is no domain-wide
 * delegation to configure, no admin user to impersonate, and no Workspace admin console step.
 * That binding covers SECURITY groups, which is why operator groups must be created as such. It authenticates as that service account through the GCP metadata
 * server, which is why it runs only on Google Cloud; operator SSO is disabled everywhere else
 * (`ADMIN_GOOGLE_SSO_ENABLED=false`) and staff access comes from `STAFF_BOOTSTRAP_EMAILS` instead.
 */

/** The read-only Cloud Identity scope the group lookup runs under. */
const GROUPS_SCOPE = 'https://www.googleapis.com/auth/cloud-identity.groups.readonly';

/** GCP's link-local metadata endpoint minting access tokens for the attached service account. */
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Cloud Identity's transitive-membership search — resolves nested groups, not just direct ones. */
const SEARCH_TRANSITIVE_GROUPS_URL =
  'https://cloudidentity.googleapis.com/v1/groups/-/memberships:searchTransitiveGroups';

/**
 * The label clause every `searchTransitiveGroups` query must carry.
 *
 * @remarks
 * Not optional and not a filter of convenience: a query without a label clause is rejected
 * outright with `INVALID_ARGUMENT`. `groups.security` is the one that pairs with the org-level
 * `roles/cloudidentity.groupsReader` IAM binding the runtime service account holds — the same
 * query against `groups.discussion_forum` answers `PERMISSION_DENIED`, because that label is
 * governed by a Workspace admin role instead. Operator groups must therefore be created as
 * SECURITY groups (`gcloud identity groups create --group-type=security`).
 */
const SECURITY_GROUPS_LABEL = "'cloudidentity.googleapis.com/groups.security' in labels";

/** Seconds of headroom applied to a cached token so it is never presented at the moment it expires. */
const TOKEN_EXPIRY_SKEW_S = 60;

/** How long a directory call may run before the sign-in it is blocking gives up on it. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** Pages to walk before giving up, so a pathological membership list cannot loop forever. */
const MAX_GROUP_PAGES = 10;

/**
 * Addresses safe to embed in a Cloud Identity query.
 *
 * @remarks
 * The lookup interpolates the address into a single-quoted CEL expression, and the API offers no
 * parameter binding. RFC 5321 permits `'` in an unquoted local part, so an address is not
 * inherently safe to splice: `a' || member_key_id == 'victim@corp.com` would return someone
 * else's groups and hand the caller their staff tier. This pattern admits only the ordinary
 * address shape — no quotes, no backslashes, no whitespace — and everything else is refused
 * rather than escaped, because a rejected lookup is a throw, which the sync treats as "unknown"
 * and never as "no groups".
 */
const SAFE_EMAIL = /^[A-Za-z0-9!#$%&*+/=?^_`{|}~.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Resolves the Google Groups an account belongs to. */
export interface GoogleDirectoryPort {
  /**
   * Every group address `email` is a transitive member of, lowercased.
   *
   * @throws {Error} when membership could not be determined. Callers MUST treat a throw as
   * "unknown", never as "no groups" — the sync revokes on an empty result, so conflating the
   * two would turn an outage into a mass revocation.
   */
  groupsFor(email: string): Promise<string[]>;
}

/** A fixed group map, for tests and for local development. */
export function staticGoogleDirectory(
  memberships: Readonly<Record<string, readonly string[]>>,
): GoogleDirectoryPort {
  return {
    groupsFor: (email) =>
      Promise.resolve((memberships[email.trim().toLowerCase()] ?? []).map((g) => g.toLowerCase())),
  };
}

/** One membership entry in a `searchTransitiveGroups` response. */
interface TransitiveGroupMembership {
  readonly groupKey?: { readonly id?: string } | undefined;
}

/** The shape of a `searchTransitiveGroups` page. */
interface SearchTransitiveGroupsResponse {
  readonly memberships?: readonly TransitiveGroupMembership[] | undefined;
  readonly nextPageToken?: string | undefined;
}

/** The metadata server's token response. */
interface MetadataTokenResponse {
  readonly access_token?: string | undefined;
  readonly expires_in?: number | undefined;
}

/**
 * The live Cloud Identity adapter, authenticating as the Cloud Run runtime service account.
 *
 * @remarks
 * Access tokens are cached until shortly before they expire, so a burst of sign-ins costs one
 * token fetch rather than one per lookup.
 *
 * @param fetchImpl - Injected for tests; defaults to the global `fetch`.
 * @param now - Injected clock for tests; defaults to `Date.now`.
 */
export function createGoogleDirectory(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): GoogleDirectoryPort {
  let cachedToken: string | undefined;
  let cachedUntilMs = 0;

  /** Forget the cached token, so the next call mints a fresh one. */
  function invalidateToken(): void {
    cachedToken = undefined;
    cachedUntilMs = 0;
  }

  async function accessToken(): Promise<string> {
    if (cachedToken !== undefined && now() < cachedUntilMs) return cachedToken;
    const response = await fetchImpl(
      `${METADATA_TOKEN_URL}?scopes=${encodeURIComponent(GROUPS_SCOPE)}`,
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Metadata server refused a Cloud Identity token (${response.status}).`);
    }
    const body = (await response.json()) as MetadataTokenResponse;
    if (!body.access_token) throw new Error('Metadata server returned no access token.');
    cachedToken = body.access_token;
    cachedUntilMs = now() + Math.max(0, (body.expires_in ?? 0) - TOKEN_EXPIRY_SKEW_S) * 1000;
    return cachedToken;
  }

  /** Fetch one page of transitive memberships for an already-validated address. */
  async function fetchGroupPage(
    normalized: string,
    token: string,
    pageToken: string | undefined,
  ): Promise<SearchTransitiveGroupsResponse> {
    const query = new URLSearchParams({
      query: `member_key_id == '${normalized}' && ${SECURITY_GROUPS_LABEL}`,
    });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetchImpl(`${SEARCH_TRANSITIVE_GROUPS_URL}?${query.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      // The token was rejected while still inside its expiry window — it was revoked or rotated
      // early. Drop it so the next attempt mints a fresh one instead of replaying a dead
      // credential for the rest of its nominal lifetime.
      invalidateToken();
      throw new Error(`Cloud Identity rejected the service account (${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(`Cloud Identity group lookup failed (${response.status}).`);
    }
    return (await response.json()) as SearchTransitiveGroupsResponse;
  }

  return {
    async groupsFor(email) {
      const normalized = email.trim().toLowerCase();
      if (!SAFE_EMAIL.test(normalized)) {
        throw new Error('Refusing to query Cloud Identity for an unexpected address shape.');
      }

      const token = await accessToken();
      const groups: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_GROUP_PAGES; page += 1) {
        const body = await fetchGroupPage(normalized, token, pageToken);
        for (const membership of body.memberships ?? []) {
          const id = membership.groupKey?.id;
          if (typeof id === 'string' && id.length > 0) groups.push(id.toLowerCase());
        }
        // A truncated membership list reads as "in fewer groups", which the sync would act on by
        // demoting or revoking — so every page must be walked before the answer is trusted.
        pageToken = body.nextPageToken;
        if (!pageToken) return groups;
      }
      throw new Error('Cloud Identity returned more group pages than the lookup will walk.');
    },
  };
}
