/**
 * `@docket/auth` — the Google Workspace group-membership lookup behind operator SSO.
 *
 * @remarks
 * Google's OIDC ID token carries no group claims, so a Workspace group can only reach Docket
 * through an API call. This module is that call, expressed as a port so the sync logic is
 * testable without a network and so local development runs against a fixture.
 *
 * The real adapter reads the **Cloud Identity Groups API**, chosen over the Admin SDK Directory
 * API because the Cloud Run runtime service account can be granted the *Groups Reader* admin role
 * directly in the Workspace admin console — there is no domain-wide delegation to configure and no
 * admin user to impersonate. It authenticates as that service account through the GCP metadata
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

/** Seconds of headroom applied to a cached token so it is never presented at the moment it expires. */
const TOKEN_EXPIRY_SKEW_S = 60;

/** How long a directory call may run before the sign-in it is blocking gives up on it. */
const LOOKUP_TIMEOUT_MS = 5_000;

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
      Promise.resolve(
        [...(memberships[email.trim().toLowerCase()] ?? [])].map((g) => g.toLowerCase()),
      ),
  };
}

/** One membership entry in a `searchTransitiveGroups` response. */
interface TransitiveGroupMembership {
  readonly groupKey?: { readonly id?: string } | undefined;
}

/** The shape of a `searchTransitiveGroups` page. */
interface SearchTransitiveGroupsResponse {
  readonly memberships?: readonly TransitiveGroupMembership[] | undefined;
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

  return {
    async groupsFor(email) {
      const token = await accessToken();
      const query = new URLSearchParams({
        query: `member_key_id == '${email.trim().toLowerCase()}'`,
      });
      const response = await fetchImpl(`${SEARCH_TRANSITIVE_GROUPS_URL}?${query.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Cloud Identity group lookup failed (${response.status}).`);
      }
      const body = (await response.json()) as SearchTransitiveGroupsResponse;
      return (body.memberships ?? [])
        .map((m) => m.groupKey?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .map((id) => id.toLowerCase());
    },
  };
}
