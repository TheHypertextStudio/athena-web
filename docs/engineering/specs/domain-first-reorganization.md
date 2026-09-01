# Domain ownership

**Status:** Implemented
**Decision date:** 2026-08-13
**Completed:** 2026-08-31

Maintainers must put each portable business contract or rule in the domain that owns the concept.
They must keep transport, persistence, provider, and presentation shapes at their delivery edges.
The retired contract package is deleted, and no compatibility facade replaces it.

## Decision

Docket uses the existing top-level `domains/*` pnpm workspace for portable business vocabulary,
validation, and pure rules. Docket does not use a `types`, `shared`, `core`, `common`, or ID package.
Each domain exposes explicit package subpaths and no wildcard root barrel.

The component diagram in
[`domain-ownership.mmd`](./domain-ownership.mmd) shows the allowed workspace-level dependencies.
The machine-readable source of truth is
[`domains/registry.json`](../../../domains/registry.json). The registry records each domain's owner,
public exports, runtime dependencies, and supported runtimes. Repository policies compare the
registry with package manifests and source imports.

## Ownership

| Owner                     | Portable concepts                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@docket/work`            | Initiatives, programs, projects, milestones, cycles, tasks, labels, comments, attachments, templates, recurrence, statuses, and saved views |
| `@docket/planning`        | Calendar, agenda, daily planning, scheduling, time tracking, time sharing, and work location                                                |
| `@docket/identity-access` | Organizations, actors, teams, memberships, roles, grants, accounts, sessions, OAuth vocabulary, and passkeys                                |
| `@docket/athena`          | Agents, Athena sessions, assignments, mail context, elicitation, voice, and phone                                                           |
| `@docket/connections`     | Integrations, providers, external resources, provider events, and Notion mirror behavior                                                    |
| `@docket/automation`      | Automation grammar, configuration, and pure evaluation                                                                                      |
| `@docket/notifications`   | Notification intent, preferences, audience, delivery, and inbox projection                                                                  |
| `@docket/integrations`    | MCP Apps protocol and connector implementation                                                                                              |

`@docket/notifications` lives under `domains/notifications`. `@docket/planning` lives under
`domains/planning`. Both use the existing `domains/*` workspace glob.

## Edge ownership

The API owns HTTP input schemas, response DTOs, pagination, Problems, search results, aggregate read
models, route serializers, and OpenAPI names. Feature modules keep those contracts beside the route
or service that owns them. The API maps Drizzle records to response objects explicitly.

The only public client type boundary is `@docket/api/rpc-contract`. Web and Admin may import that
subpath only in erased type positions through the Hono and TanStack Query layer. They do not import
API runtime schemas. Each client feature owns runtime parsing, navigation state, fixtures, and
view-only projections that only its presentation needs.

`@docket/db` owns Drizzle records, persistence-only JSON shapes, schema metadata, migrations, and ID
generation. A database record is not a domain contract or API response by default.

`@docket/auth` and `@docket/authz` adapt authentication and persisted authorization facts to
Identity & Access contracts. `@docket/integrations` adapts provider SDKs and MCP Apps to Connections,
Work, Athena, and integration-owned protocol contracts. `@docket/ui` receives domain-neutral props;
it does not depend on API DTOs.

## Public exports

Every public contract has a named subpath such as `@docket/work/ids`,
`@docket/planning/calendar-contract`, or `@docket/identity-access/passkey`. A package manifest and
`domains/registry.json` must declare the same subpaths. Production code cannot import another
domain's private files, testing exports, delivery applications, UI components, environment
singletons, or provider SDK implementations.

Use these suffixes consistently:

- `protocol` names a stateful exchange carried across multiple messages.
- `contract` names one fixed entity or interface shape.
- `contracts` aggregates several related contract shapes in one module.

A fixed value does not become a protocol because its product name uses that word.

## Identifier rule

Each domain owns the branded IDs for its entities. The domain defines its small ULID Zod rule
privately and exports only its named branded schemas and types. Domains do not share an ID package.
`@docket/db` is the only ID generator.

Repository behavior tests apply the same canonical examples to every domain ID. They require valid
uppercase ULIDs and reject malformed values, lowercase values, UUIDs, and wrong-length values. This
test prevents duplicated private validators from drifting without coupling the domains through a
validator package.

## Dependency rules

Delivery applications may compose domains and technical adapters. Domain code may depend only on
declared domain contracts, pure rules, and narrow runtime libraries. Domain code cannot depend on
Next, Hono, Drizzle, Cloudflare bindings, provider SDKs, or presentation code.

Routes, MCP handlers, cron jobs, queues, and workflows invoke domain rules or application services.
Persistence adapters map database records to domain contracts. Provider adapters map provider SDK
objects to domain or integration contracts. The physical Drizzle schema and migration history stay
centralized in `@docket/db`.

## Enforcement

Repository policies enforce all of these conditions:

- The retired package directory, manifest, workspace edge, lockfile importer, exports, source
  imports, type imports, re-exports, dynamic imports, and CommonJS loads cannot return.
- Each formerly exported module has one declared owner.
- Domain manifests and `domains/registry.json` expose the same explicit subpaths and dependencies.
- Domain IDs pass one compatibility matrix and reject UUID validators.
- Web and Admin use `@docket/api/rpc-contract` only as an erased type boundary.
- No domain exports a wildcard root barrel or imports private paths from another domain.
- The OpenAPI document and Drizzle migration tree stay unchanged during ownership-only moves.

Deliberate negative-test fixtures may contain the retired package name. Immutable migration comments
may retain historical names when changing the migration would alter its checksum. Production code,
manifests, lockfiles, exports, and current architecture documentation may not contain that name.

## Change criteria

A future ownership change must start with behavior tests, update the domain registry and manifest,
migrate consumers through explicit subpaths, and run the repository gates. A wire or persistence
change requires its own characterized change. A code-organization change cannot modify routes,
status codes, response fields, Problem codes, authorization, migrations, or user-visible behavior.

## Rejected alternatives

Docket does not use one validator package because a package that only shares a five-line ULID rule
creates dependency coupling without owning a business concept. Docket does not use a global ID,
shared, core, common, or contracts package because each recreates the warehouse under another name.
Docket does not make clients import API runtime schemas because that binds presentation builds to
server implementation code instead of the typed RPC boundary.

We would revisit domain-local ID validation only if IDs gained shared executable behavior beyond
validation, such as a cross-domain allocation protocol. Matching syntax alone does not meet that
bar.
