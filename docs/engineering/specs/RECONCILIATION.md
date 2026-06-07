# Docket Specs — Reconciliation & Canonical Decisions

> **This file is the TIE-BREAKER** over the individual specs in this folder. Where a spec disagrees with this file, **this file wins.** Produced after the spec-lock consistency review (verdict: _after-conflicts-resolved_). The build (foundation + first vertical slice) follows these decisions.

## Resolved cross-spec conflicts

1. **IDs — `text` ULIDs repo-wide.** Every PK is `text("id").primaryKey().$defaultFn(genId)` with a single ULID generator in `@docket/db/src/id.ts`; set Better Auth `advanced.database.generateId` to the same generator so `user.id` is `text` and all FKs line up. **No Postgres `uuid`.** The permissions spec's `uuid(...)` columns are overridden → `text(...)`.
2. **One `grant` table** (data-model names authoritative). Fold the permissions spec's extra columns in: `effect {allow,deny}` (default `allow`), `cascades bool`, `visibility_override`, `expires_at`. Delete the divergent `permission_grant`.
3. **Role** = data-model names + `key`, `is_system`, `base_capability`, `default_visibility`. `Role.capabilities` is a **flat `GrantCapability[]` jsonb** (not a per-resource grid); the API `RoleCreate` DTO aligns to the flat shape.
4. **Naming/enums:** `resource_kind` (one `pgEnum` in `@docket/db/src/enums.ts`); `grant_subject_kind {actor, role}`. Never `resource_type`.
5. **Visibility columns:** add nullable `visibility {public,private}` (default `public`) to `team/program/project/task`, plus optional `ancestor_path text[]` (GIN-indexed) for cascade resolution. The permission resolver reads these.
6. **Capability wire form:** the bare literal (`view|comment|contribute|assign|manage`) is the stored/Zod value (`Capability` in `@docket/types`). `org:*` is **only** an API route-annotation label.
7. **Shared `Id` schema:** `@docket/types` exports one branded `Id` (ULID-shaped) consumed by **both** the API and MCP tool schemas. MCP must **not** use `z.string().uuid()`. Addressing differs intentionally — REST `/orgs/{id}`, MCP `docket://{slug}` — but the id primitive is identical.
8. **Routes:** `/v1/orgs/:orgId/...` nesting is canonical (tenant key in the path). The slice's top-level `/organizations`,`/projects`,`/tasks` are rewritten to the nested form.
9. **Input schemas:** PascalCase `*Create` (`OrgCreate`, `ProjectCreate`, `TaskCreate`) is canonical; the slice's `create*Input` names are renamed.
10. **Task default state:** app sets `state = team.workflow_states[0].key`; the default team's first state is `backlog`. No DB default column.

## Decisions (open issues resolved)

- **ID generator:** ULID.
- **Better Auth organization plugin: OFF.** Docket owns custom `organization` + `actor` (human Actor folds in membership). Invitations = a hand-built Docket `invitation` table `{id, organization_id, email, role, token, expires_at, status}` — not the plugin.
- **Auth / OIDC / MCP mount:** Hono `apps/api` owns `/api/auth/*` and `/mcp`. **web ↔ api are same-origin via Vercel rewrites** (`apps/web` rewrites `/api/*` → the api) to keep auth cookies first-party; CORS+credentials is the fallback if they must be split.
- **Org deletion:** `ON DELETE CASCADE` from `organization` through all `organization_id` FKs, plus an application purge job for external/Stripe artifacts.
- **Polymorphic subjects** (Update/Comment/Notification/audit_event/Impersonation): `(subject_type enum, subject_id text)`, app-enforced integrity, indexed `(organization_id, subject_type, subject_id)`.
- **`task_dependency` acyclicity:** app-level recursive-CTE cycle check in a `SERIALIZABLE` tx + `UNIQUE(blocking_task_id, blocked_task_id)` + `CHECK(blocking <> blocked)`.
- **Workflow states:** jsonb-embedded on `team`; `task.state` is a text key into that set.
- **DENY grants:** the `effect` column exists (default `allow`), but **deny is deferred from v1** (allow-only resolver path) — forward-compatible.
- **Idempotency-Key:** a Postgres `idempotency_key` table (24h TTL) for v1 — no Redis.
- **Session live transport:** **SSE** (`GET /v1/orgs/:orgId/sessions/:id/stream`) for v1; one mechanism.
- **Personal space:** single-Actor; the owning User is seeded as Owner; invitations/guests rejected (app guard).
- **Billing split:** lifecycle columns (`lifecycle_state`, `export_ready_at`, `delete_after_at`) live on `organization`; the Stripe plugin's `subscription` table is keyed by `reference_id = organization.id`.
- **List engine:** custom virtualized flattened tree (`@tanstack/react-virtual`) for Linear-style grouping/sub-grouping + inline edit + keyboard.
- **CI passkey login:** Playwright **CDP virtual authenticator** (exercises the real WebAuthn path); no session-seed bypass.

## Deferred to later phases (do NOT block foundation + slice)

- **MVP SCOPE CUT — product call before the feature fan-out (NOT before foundation).** How much of granular per-resource Grants, multi-org breadth, enterprise SSO/SCIM, and the agent/MCP surface ships in v1. _Default proposal:_ v1 ships the 4 system roles + simple resource sharing (resource-level `grant` present in the backend, minimal UI); SSO/SCIM, DENY grants, and the full capability grid are fast-follows. **Confirm at the fan-out gate.**
- **MCP phase — verify Better Auth 1.6.14:** that it emits `client_id_metadata_document_supported` (CIMD), honors RFC 8707 `resource→aud` stamping, and surfaces `getMcpSession().scopes`. If any is absent, add a thin RS shim. Adopt MCP **Tasks** behind a feature flag. Stateful resumable MCP sessions need a shared event store (Redis) + a long-lived host (Vercel Fluid Compute) — confirm at the MCP phase.
- **Billing phase:** export artifact format/scope; no-card vs card-required trial default; dunning terminal state.
- **Approval-routing storage:** the resolver (assigner/delegator → team → org → owners) — pin its storage location (Agent column vs Team settings) at the agents/sessions phase.

---

_The seven area specs (`data-model`, `api-rpc-contract`, `permissions`, `design-system`, `env-and-bootstrap`, `mcp-surface`, `build-sequence-and-slice`) remain the detailed reference; read them through the lens of the decisions above._
