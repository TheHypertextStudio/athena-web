# Public API version policy

API maintainers must use this policy when changing the public REST contract or building a release.

The initial explicit public contract is `0.1.0`. This number records the start of explicit public
compatibility tracking. It does not claim that every documented capability was introduced in this
release. The sole runtime compatibility value lives in `apps/api/api-version.json`.

## Client assertions

A client can omit `Docket-Version` to use the current contract. A client can instead send the exact
current value to assert that contract. Docket supports one contract at a time. The header does not
select a historical implementation. Empty values, repeated values, comma lists, ranges, aliases,
malformed versions, and any older or newer version receive HTTP 400 with
`unsupported_api_version`. The Problem includes `requestedVersion` and `supportedVersions`.

The assertion applies to every public business operation under `/v1`, including anonymous briefs,
public time status, export downloads, and streams. `/v1/docs`, `/v1/openapi.json`,
`/v1/docs/assets/*`, `/v1/health`, and OPTIONS remain available when the assertion is unsupported.
MCP, Better Auth, OAuth discovery, webhooks, internal routes, and staff routes are separate surfaces.

## Response and build identity

Every `/v1` response identifies its contract with `Docket-Version` and its artifact with
`Docket-Revision`. The boundary surrounds CORS, while request rejection runs after CORS and before
session lookup, OAuth verification, body consumption, and application side effects.

Source execution uses revision `dev`. The runtime bundle embeds the full 40-character hexadecimal
Git SHA. The existing image workflow passes its `github.sha` as the build-only
`DOCKET_BUILD_REVISION` argument. Local builds read `git rev-parse HEAD`. Production refuses a
missing, short, malformed, or `dev` revision. Cloud Run has no separately configured revision
variable. API runtime builds cannot reuse a source-only Turbo cache because a commit with identical
source still has a different revision.

Public OpenAPI advertises the compatibility version and revision. Staff OpenAPI advertises
`internal-<short SHA>` and the full revision. Root package version `1.3.0`, OpenAPI format `3.1.0`,
MCP protocol version, and MCP server version remain separate identifiers.

## Prerelease changes

Before version `1.0.0`, incompatible public contract changes advance the minor number. Compatible
additions and corrections advance the patch number. Each contract change records machine-readable
release facts beside `apps/api/api-version.json`. Documentation generation consumes those facts.
Release checks must compare the normalized contract with the previously released snapshot.

The initial facts are in `apps/api/api-releases.json`. OAuth REST credentials, operation-owned
runtime guarantees, generated snapshots, the public reference shell, and release gates remain under
the approved [public API remediation plan](public-api-reference-remediation.md).
