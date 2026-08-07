/**
 * `@docket/env/custom-domain` — normalizing, verifying, and routing per-workspace domains.
 *
 * @remarks
 * A workspace can serve its published briefs from a domain it owns (CORE-29 … CORE-31,
 * MISS-04). Three things have to be true before that is safe, and all three are here so no
 * feature has to re-derive them:
 *
 * 1. **One host, one spelling.** `Example.COM.`, `www.example.com`, and `https://example.com/x`
 *    are the same claim. Uniqueness (CORE-30) is only enforceable if every caller normalizes
 *    identically before it writes a row or compares one, so normalization is a shared function
 *    rather than a convention.
 * 2. **Ownership is proved, not asserted.** A domain is persisted unverified and refuses to
 *    serve until a DNS `TXT` record carries a workspace-specific token (CORE-31).
 * 3. **The refusal is legible.** Every rejection is a stable code, never provider or resolver
 *    text — the repo's UI-copy rule is that application copy is application-owned, and DNS
 *    error strings are neither owned nor trustworthy (a resolver echoes attacker-controlled
 *    record data).
 *
 * Pure by construction: DNS is injected as {@link TxtLookup}, so this module has no `node:dns`
 * import, runs anywhere, and is testable without a network.
 *
 * @see {@link ./hosts} for the product's own hosts, which are configuration, not user input.
 */

/**
 * Reduce a URL, an authority, or a bare hostname to its lowercased hostname.
 *
 * @remarks
 * Someone pasting a domain into the settings field types whatever their registrar showed them —
 * `https://docket.place/`, `docket.place:1355`, `Docket.Place.` — so the parsing happens here
 * once rather than in each caller.
 *
 * @param value - A non-empty URL, `host[:port]` authority, or bare hostname.
 * @returns The lowercased hostname, or `undefined` when the value has none.
 */
function hostnameOf(value: string): string | undefined {
  // `new URL` needs a scheme; adding a placeholder one is cheaper and safer than a regex that
  // has to re-implement IPv6 bracket syntax and userinfo stripping.
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host.length === 0 ? undefined : host;
}

/** DNS label the verification `TXT` record is published under. */
export const CUSTOM_DOMAIN_TXT_LABEL = '_docket-verify';

/** Prefix inside the `TXT` value, so unrelated records at the same name are ignored. */
export const CUSTOM_DOMAIN_TXT_PREFIX = 'docket-domain-verification=';

/** TTL Docket asks operators to publish the verification record with. */
export const CUSTOM_DOMAIN_TXT_TTL_SECONDS = 300;

/** Length in hex characters of a verification token (16 random bytes). */
export const CUSTOM_DOMAIN_TOKEN_LENGTH = 32;

/** Maximum total length of a DNS name, per RFC 1035. */
const MAX_HOST_LENGTH = 253;
/** Maximum length of a single DNS label, per RFC 1035. */
const MAX_LABEL_LENGTH = 63;

/**
 * Why a submitted domain was refused. Stable codes — the UI owns the wording for each.
 *
 * @remarks
 * - `empty` — nothing was submitted.
 * - `unparsable` — no hostname could be read out of the input at all.
 * - `too-long` / `label-too-long` — beyond the DNS limits, so it could never resolve.
 * - `invalid-label` — a label is empty, starts/ends with `-`, or holds characters outside
 *   `a-z 0-9 -` once the name has been punycoded.
 * - `not-a-domain` — a single label (`localhost`, an IPv6 literal) or an IPv4 literal; none of
 *   these can be DNS-verified or certificated.
 * - `wildcard` — a `*` in the name; Docket serves exact hosts.
 * - `reserved` — the host sits on Docket's own apex, so claiming it would let a workspace
 *   serve content from the product's domain.
 */
export type CustomDomainRejection =
  | 'empty'
  | 'unparsable'
  | 'too-long'
  | 'label-too-long'
  | 'invalid-label'
  | 'not-a-domain'
  | 'wildcard';

/** The outcome of {@link normalizeCustomDomain}. */
export type CustomDomainNormalization =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly reason: CustomDomainRejection };

/** A `www.` prefix is stripped so both spellings collapse to one claim (CORE-30). */
const WWW_PREFIX = 'www.';

/** Characters a DNS label may contain once the name is punycoded. */
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** An IPv4 literal, which is a valid `URL` hostname but not a domain anyone can verify. */
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Reduce user input to the one canonical spelling of a host, or say why it cannot be one.
 *
 * @remarks
 * Accepts what people actually paste — a full URL, a bare host, mixed case, a trailing dot,
 * `www.` — and collapses it. **The result is the uniqueness key**: persist it, index it with a
 * unique constraint, and compare against it. Two workspaces submitting `Example.com` and
 * `https://www.example.com/` must collide, and they only do if both went through here.
 *
 * `www.` stripping is worth being explicit about: it means a workspace claims `example.com`
 * and serves both spellings, rather than two workspaces owning two halves of one site.
 *
 * Internationalized names are handled for free and correctly: the WHATWG URL parser applies
 * UTS-46, so `münchen.example` and `xn--mnchen-3ya.example` both normalize to the punycode
 * form and collapse to one claim. That is also why the label pattern below is ASCII-only —
 * by the time it runs, every name is punycoded.
 *
 * @param input - Whatever the user typed or pasted.
 * @param reserved - The hosts and apex the product itself answers on.
 * @returns The canonical host, or a stable rejection code.
 *
 * @example
 * ```ts
 * normalizeCustomDomain(' https://WWW.Example.com/briefs ');
 * // { ok: true, host: 'example.com' }
 * ```
 */
export function normalizeCustomDomain(input: string | undefined | null): CustomDomainNormalization {
  if (input === undefined || input === null || input.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  // Checked before parsing: `new URL` treats `*` as a valid hostname character, so a wildcard
  // would otherwise sail through and be persisted as a literal host that can never resolve.
  if (input.includes('*')) return { ok: false, reason: 'wildcard' };

  const parsed = hostnameOf(input);
  if (parsed === undefined) return { ok: false, reason: 'unparsable' };

  let host = parsed;
  if (host.startsWith(WWW_PREFIX)) host = host.slice(WWW_PREFIX.length);

  if (host.length > MAX_HOST_LENGTH) return { ok: false, reason: 'too-long' };

  const labels = host.split('.');
  // Catches `localhost` and IPv6 literals alike: `URL` hands back `[2606:4700::1111]`, which has
  // no dots, so it lands here rather than needing a separate address check.
  if (labels.length < 2) return { ok: false, reason: 'not-a-domain' };
  if (IPV4_PATTERN.test(host)) return { ok: false, reason: 'not-a-domain' };

  for (const label of labels) {
    if (label.length > MAX_LABEL_LENGTH) return { ok: false, reason: 'label-too-long' };
    if (!LABEL_PATTERN.test(label)) return { ok: false, reason: 'invalid-label' };
  }

  return { ok: true, host };
}

/**
 * Mint a fresh verification token.
 *
 * @remarks
 * Per domain row, not per workspace: two domains in one workspace get different tokens, so
 * publishing one record never verifies the other. 128 bits from a CSPRNG — the token is the
 * whole proof of ownership, so it must not be guessable by someone who can see the record name.
 *
 * @param randomBytes - Byte source; defaults to the platform CSPRNG. Injected for tests only.
 * @returns A lowercase hex token of {@link CUSTOM_DOMAIN_TOKEN_LENGTH} characters.
 */
export function generateCustomDomainToken(
  randomBytes: (count: number) => Uint8Array = defaultRandomBytes,
): string {
  return [...randomBytes(CUSTOM_DOMAIN_TOKEN_LENGTH / 2)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Platform CSPRNG — present in Node 18+ and every browser Docket supports. */
function defaultRandomBytes(count: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

/** A DNS record Docket asks the domain's operator to publish, ready to render verbatim. */
export interface DomainDnsRecord {
  /** Record type, shown in the UI's "Type" column. */
  readonly type: 'TXT' | 'CNAME';
  /** Fully-qualified record name, shown in the "Name" column. */
  readonly name: string;
  /** Record value, shown in the "Value" column. */
  readonly value: string;
  /** Suggested TTL in seconds. */
  readonly ttlSeconds: number;
}

/**
 * The exact `TXT` record that proves ownership of `host`.
 *
 * @remarks
 * CORE-31 requires the UI to display the record's type, name, and value exactly; returning a
 * struct rather than a formatted string is what lets the UI lay it out as a copyable table
 * without parsing anything back out.
 *
 * @param host - A host already through {@link normalizeCustomDomain}.
 * @param token - The token from {@link generateCustomDomainToken}.
 * @returns The record to publish.
 *
 * @example
 * ```ts
 * domainVerificationRecord('example.com', 'a1b2…');
 * // { type: 'TXT', name: '_docket-verify.example.com',
 * //   value: 'docket-domain-verification=a1b2…', ttlSeconds: 300 }
 * ```
 */
export function domainVerificationRecord(host: string, token: string): DomainDnsRecord {
  return {
    type: 'TXT',
    name: `${CUSTOM_DOMAIN_TXT_LABEL}.${host}`,
    value: `${CUSTOM_DOMAIN_TXT_PREFIX}${token}`,
    ttlSeconds: CUSTOM_DOMAIN_TXT_TTL_SECONDS,
  };
}

/**
 * The `CNAME` that makes a verified domain actually serve briefs.
 *
 * @remarks
 * Verification proves ownership; it does not route traffic. MISS-04 requires the domain to
 * serve over HTTPS once verified, which needs the host pointed at Docket's brief edge — the
 * target comes from `CUSTOM_DOMAIN_CNAME_TARGET`, falling back to the brief host, so it is
 * configuration rather than a constant baked into the settings screen.
 *
 * @param host - A host already through {@link normalizeCustomDomain}.
 * @param target - The CNAME target, from `CUSTOM_DOMAIN_CNAME_TARGET`.
 * @returns The record to publish.
 * @throws {Error} When no custom-domain target is configured.
 */
export function domainRoutingRecord(host: string, target: string | undefined): DomainDnsRecord {
  if (target === undefined) {
    throw new Error('No custom-domain target is configured. Set CUSTOM_DOMAIN_CNAME_TARGET.');
  }
  return {
    type: 'CNAME',
    name: host,
    value: target,
    ttlSeconds: CUSTOM_DOMAIN_TXT_TTL_SECONDS,
  };
}

/**
 * A DNS `TXT` lookup.
 *
 * @remarks
 * Matches `node:dns/promises`'s `resolveTxt` (which returns one array of string chunks per
 * record, because a `TXT` string longer than 255 bytes is transmitted split), and also accepts
 * a flat `string[]` so a simpler resolver — or a test — can be passed straight in. Rejecting is
 * the correct behavior for `NXDOMAIN`; the caller does not pre-check.
 */
export type TxtLookup = (name: string) => Promise<readonly (string | readonly string[])[]>;

/** Why verification did not succeed. Stable codes; the UI owns the wording. */
export type DomainVerificationFailure = 'lookup-failed' | 'no-record' | 'token-mismatch';

/** The outcome of {@link verifyCustomDomain}. */
export interface DomainVerificationResult {
  /** Whether the domain may now be marked verified and allowed to serve. */
  readonly verified: boolean;
  /** The host that was checked. */
  readonly host: string;
  /** The record that was expected, so a failing UI can re-display it without recomputing. */
  readonly record: DomainDnsRecord;
  /** Absent exactly when {@link DomainVerificationResult.verified} is `true`. */
  readonly failure?: DomainVerificationFailure;
  /**
   * How many `TXT` values carrying Docket's prefix were seen at the record name.
   *
   * @remarks
   * A count, never the values. The values are attacker-controllable strings from a domain
   * Docket does not own, and rendering them would put third-party text into application copy.
   * The count is what distinguishes "you have not published it yet" (0) from "you published
   * the wrong token, or an old one" (≥1), which is the only distinction a user needs.
   */
  readonly observedCount: number;
}

/** Flatten one `resolveTxt` entry (chunked or flat) into a single string. */
function joinTxt(entry: string | readonly string[]): string {
  return typeof entry === 'string' ? entry : entry.join('');
}

/**
 * Check whether the ownership `TXT` record for `host` currently carries `token`.
 *
 * @remarks
 * Verification is re-run, not cached: a domain that stops proving ownership should stop
 * serving. Matching is exact on the full `prefix + token` value, so a record that merely
 * contains the token as a substring does not pass.
 *
 * @param args - The host, its expected token, and the resolver to use.
 * @returns Whether ownership is currently proved, with a stable failure code when it is not.
 *
 * @example
 * ```ts
 * import { resolveTxt } from 'node:dns/promises';
 * const result = await verifyCustomDomain({ host, token, lookupTxt: resolveTxt });
 * if (!result.verified) return problem('domain_verification_failed', result.failure);
 * ```
 */
export async function verifyCustomDomain(args: {
  readonly host: string;
  readonly token: string;
  readonly lookupTxt: TxtLookup;
}): Promise<DomainVerificationResult> {
  const record = domainVerificationRecord(args.host, args.token);

  let entries: readonly (string | readonly string[])[];
  try {
    entries = await args.lookupTxt(record.name);
  } catch {
    // Includes NXDOMAIN, SERVFAIL, and timeouts. All mean the same thing to the caller: nothing
    // was proved. The resolver's own message is deliberately dropped rather than surfaced.
    return { verified: false, host: args.host, record, failure: 'lookup-failed', observedCount: 0 };
  }

  const values = entries.map(joinTxt);
  const ours = values.filter((value) => value.startsWith(CUSTOM_DOMAIN_TXT_PREFIX));
  if (ours.length === 0) {
    return { verified: false, host: args.host, record, failure: 'no-record', observedCount: 0 };
  }
  if (!ours.includes(record.value)) {
    return {
      verified: false,
      host: args.host,
      record,
      failure: 'token-mismatch',
      observedCount: ours.length,
    };
  }
  return { verified: true, host: args.host, record, observedCount: ours.length };
}
