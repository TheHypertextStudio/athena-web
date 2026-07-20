# Billing Exemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `superadmin` staff grant a specific organization permanent, free, unlimited agent-session access — bypassing the Stripe-driven `lifecycleState` gate entirely — with a durable, auditable grant/revoke record.

**Architecture:** A new `billing_exemption` grant-log table (mirrors the existing `lifecycle_hold` table exactly: a row is the grant, a nullable `revokedAt` ends it). `assertAgentSessionsEntitled` gains an extra check: an active exemption row satisfies entitlement regardless of `lifecycleState`. Two new `superadmin`-gated admin routes (`POST`/`DELETE /orgs/:id/billing-exemption`) grant/revoke it, writing to the existing `operator_audit_event` table. `AdminOrgOut` gains `isBillingExempt` for back-office visibility.

**Tech Stack:** Drizzle ORM (Postgres, PGlite in tests), Hono, Zod, Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-19-billing-exemption-design.md`

---

## File Structure

- **Modify** `packages/db/src/schema/admin.ts` — add the `billingExemption` table.
- **Generate** `packages/db/drizzle/00NN_<name>.sql` (+ `meta/` snapshot/journal updates) — via `drizzle-kit generate`, not hand-written.
- **Modify** `apps/api/src/admin-dto.ts` — add `AdminBillingExemptionOut`, `GrantExemptionBody`; add `isBillingExempt` to `AdminOrgOut`.
- **Modify** `apps/api/src/routes/admin-serializers.ts` — add `ExemptionRow` type, `toExemptionOut`, `loadActiveExemptOrgIds`; extend `toOrgOut` to accept an exempt-id set.
- **Modify** `apps/api/src/billing/entitlement.ts` — check for an active exemption alongside `lifecycleState`.
- **Modify** `apps/api/src/routes/admin-billing-routes.ts` — add the grant/revoke routes.
- **Modify** `apps/api/src/routes/admin.ts` — wire `isBillingExempt` into the three `toOrgOut` call sites (list, get-by-id, lifecycle board).
- **Test** `apps/api/tests/agent/entitlement.test.ts` — exemption bypasses the lifecycle check.
- **Test** `apps/api/tests/routes/admin.test.ts` — grant/revoke route behavior, role gating, `isBillingExempt` visibility.

---

## Task 1: `billing_exemption` schema + migration

**Files:**

- Modify: `packages/db/src/schema/admin.ts`

- [ ] **Step 1: Add the table**

Open `packages/db/src/schema/admin.ts`. Add this export at the end of the file (after `operatorAuditEvent`):

```ts
/** A permanent, staff-granted billing exemption on an org (bypasses the Stripe-driven lifecycle gate). */
export const billingExemption = pgTable(
  'billing_exemption',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    grantedBy: text('granted_by').references(() => staffUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    revokedBy: text('revoked_by').references(() => staffUser.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [
    index('billing_exemption_org_idx').on(t.organizationId),
    uniqueIndex('billing_exemption_org_active_uq')
      .on(t.organizationId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
```

This requires adding `sql` to the existing drizzle-orm import at the top of the file. Change:

```ts
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
```

to:

```ts
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Generate the migration**

From the repo root (requires `.env.local` with `DATABASE_URL`/`DATABASE_URL_UNPOOLED` set — see `.env.example` if missing):

Run: `pnpm db:generate`

Expected: a new file appears at `packages/db/drizzle/00NN_<adjective_name>.sql` (NN = next sequential number after the current highest in `packages/db/drizzle/meta/_journal.json`), containing a `CREATE TABLE "billing_exemption" (...)`, two `ALTER TABLE ... ADD CONSTRAINT` foreign keys, an index, and a partial unique index. `packages/db/drizzle/meta/_journal.json` and a new snapshot file under `packages/db/drizzle/meta/` are also updated — commit all of these together with the schema change.

- [ ] **Step 3: Verify the generated SQL**

Read the new `.sql` file. Confirm it contains:

- `CREATE TABLE "billing_exemption"` with columns `id`, `organization_id` (not null), `reason` (not null), `granted_by`, `created_at` (not null, default now), `revoked_by`, `revoked_at`.
- Two FK constraints: `organization_id → organization(id)` `ON DELETE cascade`, and both `granted_by`/`revoked_by → staff_user(id)` `ON DELETE set null`.
- `CREATE INDEX "billing_exemption_org_idx" ... USING btree ("organization_id")`.
- A `CREATE UNIQUE INDEX "billing_exemption_org_active_uq" ... WHERE "revoked_at" IS NULL` (partial unique index) — this is the critical race-safety guard from the design doc; if drizzle-kit did not emit the `WHERE` clause, do not proceed — check the `.where(sql\`...\`)` syntax on the index builder in Step 1 and regenerate.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: no errors; the command exits 0. (Test suites apply migrations independently via `drizzle-orm/pglite/migrator`'s `migrate()` against the same `packages/db/drizzle` folder, so this step is for your local/real Postgres, not the test DB.)

- [ ] **Step 5: Commit**

```bash
git restore --staged .
git add packages/db/src/schema/admin.ts packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(billing): Add the billing_exemption grant-log table

Adds a table for staff to record permanent free-access grants on an org,
mirroring the existing lifecycle_hold pattern: a row is the grant, a
nullable revokedAt ends it. A partial unique index on
(organization_id) WHERE revoked_at IS NULL prevents two concurrent
active grants on the same org at the database level.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Entitlement check — exemption bypasses `lifecycleState`

**Files:**

- Modify: `apps/api/src/billing/entitlement.ts`
- Test: `apps/api/tests/agent/entitlement.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/api/tests/agent/entitlement.test.ts`. Add this import at the top, alongside the existing imports (after line 8's `vi.mock` call, with the other `import` statements):

```ts
import { billingExemption } from '@docket/db';
```

Add this test inside the existing `describe('assertAgentSessionsEntitled', ...)` block (after the existing `it('allows trialing and active...')` test, before the closing `});` of the `describe`):

```ts
it('an active exemption entitles a non-entitled org; revoking it removes entitlement', async () => {
  const lapsed = await seedOrg('export_window');
  await expect(assertAgentSessionsEntitled(lapsed.orgId)).rejects.toMatchObject({
    status: 402,
    code: 'agent_plan_required',
  });

  const [grant] = await db
    .insert(billingExemption)
    .values({ organizationId: lapsed.orgId, reason: 'internal free use' })
    .returning({ id: billingExemption.id });
  await expect(assertAgentSessionsEntitled(lapsed.orgId)).resolves.toBeUndefined();

  await db
    .update(billingExemption)
    .set({ revokedAt: new Date() })
    .where(eq(billingExemption.id, grant!.id));
  await expect(assertAgentSessionsEntitled(lapsed.orgId)).rejects.toMatchObject({
    status: 402,
    code: 'agent_plan_required',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @docket/api test tests/agent/entitlement.test.ts`
Expected: FAIL — the new test's first assertion (`rejects.toMatchObject`) passes (org starts unentitled), but the second assertion fails because granting an exemption does nothing yet: `assertAgentSessionsEntitled` still throws `AgentPlanRequiredError` after the grant is inserted.

- [ ] **Step 3: Implement the entitlement check**

Replace the full contents of `apps/api/src/billing/entitlement.ts` with:

```ts
/**
 * `@docket/api` — the Athena entitlement gate.
 *
 * @remarks
 * Athena is a paid-plan feature. The gate reads the org's billing
 * **lifecycle state** — the durable truth the Stripe webhooks maintain — rather than
 * making a live billing call: `trialing` counts as entitled (the trial IS the
 * funnel) alongside `active`; everything else (`past_due`, `export_window`, …)
 * refuses with a typed 402 the web app renders as a targeted upsell — UNLESS the
 * org holds an active {@link billingExemption} grant, a staff-issued permanent
 * bypass that is independent of Stripe entirely (see `POST /admin/orgs/:id/billing-exemption`).
 *
 * Enforced at ONE choke point — the first run of {@link driveSession} — which covers
 * every door: the REST session routes, the `trigger_agent` MCP tool, and the
 * proactive sweep. Resumes of an already-started session are deliberately NOT
 * re-gated, so an approval arriving after a plan lapse still lands the work the
 * user already reviewed.
 */
import { billingExemption, db, organization } from '@docket/db';
import { eq, isNull } from 'drizzle-orm';

import { AgentPlanRequiredError, NotFoundError } from '../error';

/** The lifecycle states entitled to run agent sessions. */
const ENTITLED_STATES = new Set(['trialing', 'active']);

/**
 * Assert the org may start agent sessions, or throw the typed 402.
 *
 * @param orgId - The organization about to run a session.
 * @throws {AgentPlanRequiredError} When the org's lifecycle state is not entitled and it holds no active exemption.
 * @throws {NotFoundError} When the org does not exist.
 */
export async function assertAgentSessionsEntitled(orgId: string): Promise<void> {
  const rows = await db
    .select({
      lifecycleState: organization.lifecycleState,
      exemptionId: billingExemption.id,
    })
    .from(organization)
    .leftJoin(billingExemption, eq(billingExemption.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  if (row.exemptionId) return;
  if (!ENTITLED_STATES.has(row.lifecycleState)) {
    throw new AgentPlanRequiredError();
  }
}
```

Note this join is not yet filtered to `revokedAt IS NULL` — that's deliberately caught by the next test-run failure below, to prove the filter matters before adding it.

- [ ] **Step 4: Run test to verify it still fails on the revoke assertion**

Run: `pnpm --filter @docket/api test tests/agent/entitlement.test.ts`
Expected: FAIL — the grant now entitles correctly, but the third assertion (post-revoke) fails: `assertAgentSessionsEntitled` still resolves because the `leftJoin` has no `revokedAt IS NULL` filter, so a revoked row still matches.

- [ ] **Step 5: Add the `revokedAt IS NULL` filter**

In `apps/api/src/billing/entitlement.ts`, change the `.leftJoin(...)` call to filter on active grants only:

```ts
    .leftJoin(
      billingExemption,
      and(eq(billingExemption.organizationId, organization.id), isNull(billingExemption.revokedAt)),
    )
```

Add `and` to the `drizzle-orm` import:

```ts
import { and, eq, isNull } from 'drizzle-orm';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @docket/api test tests/agent/entitlement.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git restore --staged .
git add apps/api/src/billing/entitlement.ts apps/api/tests/agent/entitlement.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): Let an active exemption bypass the entitlement gate

assertAgentSessionsEntitled now left-joins billing_exemption (filtered to
revoked_at IS NULL) alongside the existing lifecycleState check. An org
with an active grant is entitled regardless of lifecycle state; a revoked
grant has no effect, so revoking correctly re-applies the Stripe-driven
gate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DTOs — exemption shapes + `AdminOrgOut.isBillingExempt`

**Files:**

- Modify: `apps/api/src/admin-dto.ts`

- [ ] **Step 1: Add `isBillingExempt` to `AdminOrgOut`**

In `apps/api/src/admin-dto.ts`, find the `AdminOrgOut` schema (around line 126). Add a field after `deleteAfterAt` and before `createdAt`:

```ts
  isBillingExempt: z
    .boolean()
    .describe(
      'True when a staff-granted billing exemption is currently active on this org — it bypasses the lifecycle-state entitlement gate entirely, independent of Stripe.',
    ),
```

So the schema reads:

```ts
export const AdminOrgOut = z.object({
  id: z.string().describe('The organization id.'),
  name: z.string().describe('Display name of the org.'),
  slug: z.string().describe('URL slug of the org (unique).'),
  isPersonal: z
    .boolean()
    .describe('True for a single-member personal workspace, which cannot accept invites.'),
  lifecycleState: LifecycleState.describe("The org's current data-lifecycle state."),
  exportReadyAt: z
    .string()
    .nullable()
    .describe(
      'When the export window opened (ISO-8601), or null when the org is not in/after the window. Set on entry to `export_window`; cleared on reactivation and on final deletion.',
    ),
  deleteAfterAt: z
    .string()
    .nullable()
    .describe(
      'When the deletion sweep may advance this org (ISO-8601 = export-window open + 14 days), or null when no deletion is scheduled.',
    ),
  isBillingExempt: z
    .boolean()
    .describe(
      'True when a staff-granted billing exemption is currently active on this org — it bypasses the lifecycle-state entitlement gate entirely, independent of Stripe.',
    ),
  createdAt: z.string().describe('Org creation timestamp (ISO-8601).'),
});
```

- [ ] **Step 2: Add the exemption DTOs**

In `apps/api/src/admin-dto.ts`, add these two schemas immediately after `AdminHoldOut` (around line 176, right before the `AdminLifecycleColumn` schema):

```ts
/** An active (un-revoked) billing exemption on an org. */
export const AdminBillingExemptionOut = z.object({
  id: z.string().describe('The billing-exemption id.'),
  organizationId: z.string().describe('The org this exemption applies to.'),
  reason: z.string().describe('The required free-text justification for the grant.'),
  grantedBy: z
    .string()
    .nullable()
    .describe('Staff-user id of the operator who granted the exemption, or null if unattributed.'),
  createdAt: z.string().describe('When the exemption was granted (ISO-8601).'),
  revokedBy: z
    .string()
    .nullable()
    .describe(
      'Staff-user id of the operator who revoked the exemption, or null while still active.',
    ),
  revokedAt: z
    .string()
    .nullable()
    .describe('When the exemption was revoked (ISO-8601), or null while still active.'),
});
/** Validated billing-exemption value. */
export type AdminBillingExemptionOut = z.infer<typeof AdminBillingExemptionOut>;

/** Body for granting a billing exemption (a free-text reason is required). */
export const GrantExemptionBody = z.object({
  reason: z
    .string()
    .min(1)
    .describe('Required free-text justification, recorded on the grant and in the audit event.'),
});
/** Validated grant-exemption body. */
export type GrantExemptionBody = z.infer<typeof GrantExemptionBody>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @docket/api typecheck`
Expected: FAIL — `toOrgOut` in `admin-serializers.ts` no longer satisfies `AdminOrgOut`'s shape (missing `isBillingExempt`). This is expected; Task 4 fixes it. If you'd rather confirm the DTO file itself is syntactically valid in isolation, you can skip this step and let Task 4's typecheck cover it — but running it now pins down exactly what's missing before moving on.

- [ ] **Step 4: Commit**

```bash
git restore --staged .
git add apps/api/src/admin-dto.ts
git commit -m "$(cat <<'EOF'
feat(billing): Add exemption DTOs and AdminOrgOut.isBillingExempt

New AdminBillingExemptionOut/GrantExemptionBody Zod shapes for the
upcoming grant/revoke admin routes, and an isBillingExempt flag on
AdminOrgOut so staff see exemption status on every org read (list,
detail, lifecycle board). The serializer wiring lands in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Serializers — `toExemptionOut`, `loadActiveExemptOrgIds`, `toOrgOut` update

**Files:**

- Modify: `apps/api/src/routes/admin-serializers.ts`

- [ ] **Step 1: Update imports**

In `apps/api/src/routes/admin-serializers.ts`, change:

```ts
import type { lifecycleHold, impersonationSession, staffUser, user } from '@docket/db';
import { type Database, db, operatorAuditEvent, organization } from '@docket/db';
import { eq } from 'drizzle-orm';
```

to:

```ts
import type { lifecycleHold, impersonationSession, staffUser, user } from '@docket/db';
import { type Database, billingExemption, db, operatorAuditEvent, organization } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
```

`billingExemption` moves to the value-import line (not the `import type` line) because `loadActiveExemptOrgIds` in Step 4 uses it at runtime (in a `.from(billingExemption)` query), not just as a type.

And change:

```ts
import type { AdminHoldOut, AdminImpersonationOut, AdminOrgOut, AdminStaffOut } from '../admin-dto';
```

to:

```ts
import type {
  AdminBillingExemptionOut,
  AdminHoldOut,
  AdminImpersonationOut,
  AdminOrgOut,
  AdminStaffOut,
} from '../admin-dto';
```

- [ ] **Step 2: Add the `ExemptionRow` type alias**

Add after the existing `HoldRow` type alias (near line 15):

```ts
/** ExemptionRow is the selected database row shape consumed by these API route serializers. */
export type ExemptionRow = typeof billingExemption.$inferSelect;
```

- [ ] **Step 3: Update `toOrgOut` to accept exempt-org ids**

Replace the existing `toOrgOut` function:

```ts
/** Serialize an org row into the admin org DTO shape. */
export function toOrgOut(o: OrgRow): z.input<typeof AdminOrgOut> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    isPersonal: o.isPersonal,
    lifecycleState: o.lifecycleState,
    exportReadyAt: o.exportReadyAt?.toISOString() ?? null,
    deleteAfterAt: o.deleteAfterAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}
```

with:

```ts
/**
 * Serialize an org row into the admin org DTO shape.
 *
 * @param exemptOrgIds - Org ids with a currently active billing exemption (see
 *   {@link loadActiveExemptOrgIds}); defaults to empty when the caller has no exemption context.
 */
export function toOrgOut(
  o: OrgRow,
  exemptOrgIds: ReadonlySet<string> = new Set(),
): z.input<typeof AdminOrgOut> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    isPersonal: o.isPersonal,
    lifecycleState: o.lifecycleState,
    exportReadyAt: o.exportReadyAt?.toISOString() ?? null,
    deleteAfterAt: o.deleteAfterAt?.toISOString() ?? null,
    isBillingExempt: exemptOrgIds.has(o.id),
    createdAt: o.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Add `loadActiveExemptOrgIds` and `toExemptionOut`**

Add after the existing `toHoldOut` function:

```ts
/** Load the set of org ids among `orgIds` that currently hold an active billing exemption. */
export async function loadActiveExemptOrgIds(
  database: Database,
  orgIds: readonly string[],
): Promise<Set<string>> {
  if (orgIds.length === 0) return new Set();
  const rows = await database
    .select({ organizationId: billingExemption.organizationId })
    .from(billingExemption)
    .where(
      and(inArray(billingExemption.organizationId, orgIds), isNull(billingExemption.revokedAt)),
    );
  return new Set(rows.map((r) => r.organizationId));
}

/** Serialize a billing-exemption row into its DTO shape. */
export function toExemptionOut(e: ExemptionRow): z.input<typeof AdminBillingExemptionOut> {
  return {
    id: e.id,
    organizationId: e.organizationId,
    reason: e.reason,
    grantedBy: e.grantedBy,
    createdAt: e.createdAt.toISOString(),
    revokedBy: e.revokedBy,
    revokedAt: e.revokedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @docket/api typecheck`
Expected: PASS — `toOrgOut` now satisfies `AdminOrgOut` (all three existing call sites in `admin.ts` still compile because the new `exemptOrgIds` parameter has a default, so calling `toOrgOut(row)` alone still type-checks; `isBillingExempt` correctly resolves to `false` for all of them until Task 6 wires the real value in).

- [ ] **Step 6: Commit**

```bash
git restore --staged .
git add apps/api/src/routes/admin-serializers.ts
git commit -m "$(cat <<'EOF'
feat(billing): Add exemption serializers and wire isBillingExempt default

toOrgOut takes an optional exempt-org-id set (defaulting to none, so
existing call sites keep compiling unchanged); toExemptionOut and
loadActiveExemptOrgIds follow the existing hold-serializer pattern. The
three admin.ts read paths still need to pass real exempt-id sets, which
happens once the grant/revoke routes exist (next commit).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Admin routes — grant and revoke

**Files:**

- Modify: `apps/api/src/routes/admin-billing-routes.ts`
- Test: `apps/api/tests/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/api/tests/routes/admin.test.ts`. Add this `describe` block right after the closing `});` of the existing `describe('lifecycle holds', ...)` block (before `describe('billing actions', ...)`):

```ts
describe('billing exemptions', () => {
  it('grants (audited), then revokes (audited); double-revoke 404s', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const granted = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'internal free use' }),
    });
    expect(granted.status).toBe(200);
    const exemption = await json<{ id: string; revokedAt: string | null }>(granted);
    expect(exemption.revokedAt).toBeNull();
    expect(await auditCount('billing.exemption_granted', orgId)).toBe(1);

    const orgAfterGrant = await app.request(`/orgs/${orgId}`, { method: 'GET' });
    expect((await json<{ isBillingExempt: boolean }>(orgAfterGrant)).isBillingExempt).toBe(true);

    const revoked = await app.request(`/orgs/${orgId}/billing-exemption`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect((await json<{ revokedAt: string | null }>(revoked)).revokedAt).not.toBeNull();
    expect(await auditCount('billing.exemption_revoked', orgId)).toBe(1);

    const orgAfterRevoke = await app.request(`/orgs/${orgId}`, { method: 'GET' });
    expect((await json<{ isBillingExempt: boolean }>(orgAfterRevoke)).isBillingExempt).toBe(false);

    // Revoking again 404s (no active grant).
    expect(
      (await app.request(`/orgs/${orgId}/billing-exemption`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('403s a finance user (superadmin-only action)', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('404s granting on an unknown org', async () => {
    const { userId } = await makeStaff('superadmin');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/orgs/missing/billing-exemption', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a grant with an empty reason', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('409s granting a second exemption while one is already active', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const first = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'first' }),
    });
    expect(first.status).toBe(200);
    const second = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'second' }),
    });
    expect(second.status).toBe(409);
  });

  it('404s revoking on an unknown org', async () => {
    const { userId } = await makeStaff('superadmin');
    const app = appWithSession(admin, fakeSession(userId));
    expect(
      (await app.request('/orgs/missing/billing-exemption', { method: 'DELETE' })).status,
    ).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @docket/api test tests/routes/admin.test.ts`
Expected: FAIL — every new test 404s or errors, because `/orgs/:id/billing-exemption` does not exist yet (no route registered).

- [ ] **Step 3: Implement the routes**

In `apps/api/src/routes/admin-billing-routes.ts`, update the imports:

```ts
import { db, lifecycleHold, organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminHoldOut,
  AdminOrgOut,
  ExtendTrialBody,
  PlaceHoldBody,
  SetLifecycleBody,
} from '../admin-dto';
```

becomes:

```ts
import { billingExemption, db, lifecycleHold, organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminBillingExemptionOut,
  AdminHoldOut,
  AdminOrgOut,
  ExtendTrialBody,
  GrantExemptionBody,
  PlaceHoldBody,
  SetLifecycleBody,
} from '../admin-dto';
```

and the local serializer import gains `toExemptionOut`:

```ts
import { audit, holdParam, idParam, loadOrg, toHoldOut, toOrgOut } from './admin-serializers';
```

becomes:

```ts
import {
  audit,
  holdParam,
  idParam,
  loadOrg,
  toExemptionOut,
  toHoldOut,
  toOrgOut,
} from './admin-serializers';
```

and add `ConflictError` to the error import:

```ts
import { NotFoundError } from '../error';
```

becomes:

```ts
import { ConflictError, NotFoundError } from '../error';
```

and `requireStaffRole` is already imported (line 18) — no change needed there.

Now add the two routes. Insert them into the `adminBillingRoutes` chain, immediately after the holds `.delete('/:id/holds/:holdId', ...)` block and before the `.post('/:id/extend-trial', ...)` block:

```ts
  .post(
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Grant a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Grants an organization a permanent, free, Stripe-independent bypass of the agent-session entitlement gate — the operator mechanism for comping internal or gifted accounts.

**Behavior.** Verifies the org exists (else \`404 not_found\`), then inserts a \`billing_exemption\` row with the required free-text \`reason\` and \`grantedBy = \` the acting operator. A partial unique index enforces at most one active (\`revokedAt IS NULL\`) grant per org; attempting a second concurrent grant returns \`409 conflict\`. Once granted, \`assertAgentSessionsEntitled\` treats the org as entitled regardless of \`lifecycleState\`, indefinitely, until revoked.

**Side effects.** Creates the exemption **and** writes a \`billing.exemption_granted\` operator audit event (subject = the org) capturing the exemption id and reason.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\`: unlike the time-boxed \`finance\` actions (extend-trial, reactivate), this is an indefinite, full bypass of the revenue gate — the highest-blast-radius billing action, restricted to the top tier. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Related.** \`DELETE /admin/orgs/{id}/billing-exemption\` to revoke; \`GET /admin/orgs/{id}\` reports \`isBillingExempt\`.`,
    }),
    zParam(idParam),
    zJson(GrantExemptionBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      let inserted;
      try {
        inserted = await db
          .insert(billingExemption)
          .values({ organizationId: id, reason, grantedBy: staffUserId })
          .returning();
      } catch {
        throw new ConflictError('An active billing exemption already exists for this organization');
      }
      const exemption = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!exemption) throw new NotFoundError('Exemption insert returned no row');
      await audit(db, staffUserId, 'billing.exemption_granted', 'organization', id, {
        exemptionId: exemption.id,
        reason,
      });
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
  .delete(
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Revoke a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Revokes an organization's active billing exemption, reverting it to the normal Stripe-driven entitlement gate.

**Behavior.** Atomically updates the exemption row matched by \`organizationId\` AND still active (\`revokedAt IS NULL\`), stamping \`revokedAt = now\` and \`revokedBy = \` the acting operator, in one conditional \`UPDATE\`. Returns \`404 not_found\` when no active exemption matches — including an org with no exemption at all, or one already revoked (the guard makes revoke idempotent-safe: a second call 404s rather than double-firing). Returns the now-revoked record.

**Side effects.** Writes a \`billing.exemption_revoked\` operator audit event (subject = the org) referencing the exemption id.

**Access — superadmin only.** Same tier as granting. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Related.** \`POST /admin/orgs/{id}/billing-exemption\` to grant.`,
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const revoked = await db
        .update(billingExemption)
        .set({ revokedAt: new Date(), revokedBy: staffUserId })
        .where(and(eq(billingExemption.organizationId, id), isNull(billingExemption.revokedAt)))
        .returning();
      const exemption = revoked[0];
      if (!exemption) throw new NotFoundError('Active billing exemption not found');
      await audit(db, staffUserId, 'billing.exemption_revoked', 'organization', id, {
        exemptionId: exemption.id,
      });
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
```

Note the grant route's `try`/`catch` around the insert: this is the 409-on-race guard from the design doc. The partial unique index is the actual source of truth preventing a double-grant; the `catch` turns the raw Postgres unique-violation error into a clean `409 conflict` instead of an unhandled `500`. This also naturally covers the sequential double-grant case in the test (first grant succeeds, second hits the same index violation).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @docket/api test tests/routes/admin.test.ts`
Expected: mostly PASS, but the `isBillingExempt` assertions in the first new test still FAIL — `GET /orgs/:id` doesn't populate real exempt-id sets yet (Task 4 left it defaulting to `false` always). That's expected; Task 6 fixes it. Confirm every other new assertion (grant/revoke status codes, audit counts, 403, 404, 422, 409) passes.

- [ ] **Step 5: Commit**

```bash
git restore --staged .
git add apps/api/src/routes/admin-billing-routes.ts apps/api/tests/routes/admin.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): Add grant/revoke billing-exemption admin routes

POST/DELETE /admin/orgs/:id/billing-exemption, gated to superadmin (the
highest staff tier, since an exemption is an indefinite full bypass of
the revenue gate rather than a time-boxed goodwill action like
extend-trial). Revoke is a single atomic conditional UPDATE to avoid a
double-revoke race; a concurrent double-grant is caught as a clean 409
via the partial unique index rather than surfacing a raw DB error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `isBillingExempt` into the org read paths

**Files:**

- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/tests/routes/admin.test.ts` (already added in Task 5, Step 1 — this task makes those assertions pass)

- [ ] **Step 1: Update imports**

In `apps/api/src/routes/admin.ts`, add `loadActiveExemptOrgIds` to the serializer import block:

```ts
import {
  LIFECYCLE_STATES,
  audit,
  countOf,
  idParam,
  impersonationParam,
  loadOrg,
  toAuditOut,
  toImpersonationOut,
  toOrgOut,
  toUserOut,
} from './admin-serializers';
```

becomes:

```ts
import {
  LIFECYCLE_STATES,
  audit,
  countOf,
  idParam,
  impersonationParam,
  loadActiveExemptOrgIds,
  loadOrg,
  toAuditOut,
  toImpersonationOut,
  toOrgOut,
  toUserOut,
} from './admin-serializers';
```

- [ ] **Step 2: Wire the org list route**

Find (around line 173-184):

```ts
const [items, totals] = await Promise.all([
  db
    .select()
    .from(organization)
    .where(where)
    .orderBy(desc(organization.createdAt))
    .limit(limit)
    .offset(offset),
  db.select({ n: count() }).from(organization).where(where),
]);
return ok(c, AdminOrgPage, { items: items.map(toOrgOut), total: countOf(totals) });
```

Replace with:

```ts
const [items, totals] = await Promise.all([
  db
    .select()
    .from(organization)
    .where(where)
    .orderBy(desc(organization.createdAt))
    .limit(limit)
    .offset(offset),
  db.select({ n: count() }).from(organization).where(where),
]);
const exemptIds = await loadActiveExemptOrgIds(
  db,
  items.map((i) => i.id),
);
return ok(c, AdminOrgPage, {
  items: items.map((i) => toOrgOut(i, exemptIds)),
  total: countOf(totals),
});
```

- [ ] **Step 3: Wire the org get-by-id route**

Find (around line 203-207):

```ts
        async (c) => {
          const { id } = c.req.valid('param');
          const org = await loadOrg(id);
          return ok(c, AdminOrgOut, toOrgOut(org));
        },
      )
      // ---- Lifecycle pipeline board ------------------------------------------
```

Replace with:

```ts
        async (c) => {
          const { id } = c.req.valid('param');
          const org = await loadOrg(id);
          const exemptIds = await loadActiveExemptOrgIds(db, [org.id]);
          return ok(c, AdminOrgOut, toOrgOut(org, exemptIds));
        },
      )
      // ---- Lifecycle pipeline board ------------------------------------------
```

- [ ] **Step 4: Wire the lifecycle board route**

Find (around line 228-236):

```ts
        async (c) => {
          const rows = await db.select().from(organization).orderBy(desc(organization.createdAt));
          return ok(c, AdminLifecycleBoard, {
            columns: LIFECYCLE_STATES.map((state) => ({
              lifecycleState: state,
              orgs: rows.filter((row) => row.lifecycleState === state).map(toOrgOut),
            })),
          });
        },
      )
```

Replace with:

```ts
        async (c) => {
          const rows = await db.select().from(organization).orderBy(desc(organization.createdAt));
          const exemptIds = await loadActiveExemptOrgIds(
            db,
            rows.map((r) => r.id),
          );
          return ok(c, AdminLifecycleBoard, {
            columns: LIFECYCLE_STATES.map((state) => ({
              lifecycleState: state,
              orgs: rows
                .filter((row) => row.lifecycleState === state)
                .map((row) => toOrgOut(row, exemptIds)),
            })),
          });
        },
      )
```

- [ ] **Step 5: Run the full admin route test file**

Run: `pnpm --filter @docket/api test tests/routes/admin.test.ts`
Expected: PASS — every test in the file, including the `isBillingExempt` assertions from Task 5's `'grants (audited), then revokes (audited); double-revoke 404s'` test, which were failing until now.

- [ ] **Step 6: Run the full API test suite and typecheck**

Run: `pnpm --filter @docket/api test`
Expected: PASS — no regressions elsewhere (e.g. any other test asserting the exact shape of an `AdminOrgOut`/`AdminOrgPage`/`AdminLifecycleBoard` response should still pass, since `isBillingExempt` is additive).

Run: `pnpm --filter @docket/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git restore --staged .
git add apps/api/src/routes/admin.ts
git commit -m "$(cat <<'EOF'
feat(billing): Surface isBillingExempt on every org read path

Wires loadActiveExemptOrgIds into the org list, get-by-id, and
lifecycle-board routes so staff see exemption status wherever they view
an org, not only via the audit feed. One extra indexed query per
request (batched by org-id set), which is fine for admin back-office
traffic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm --filter @docket/api test && pnpm --filter @docket/db test`
Expected: PASS, no failures.

- [ ] **Step 2: Typecheck and lint the touched packages**

Run: `pnpm --filter @docket/api typecheck && pnpm --filter @docket/db typecheck`
Expected: PASS.

Run: `pnpm --filter @docket/api lint && pnpm --filter @docket/db lint`
Expected: PASS, no errors.

- [ ] **Step 3: Confirm the migration is committed and matches the schema**

Run: `git log --oneline -- packages/db/drizzle/ | head -5`
Expected: the new migration file from Task 1 appears in the log.

Run: `pnpm db:generate` (from repo root)
Expected: drizzle-kit reports **no schema changes** (it should not generate a new migration file) — confirming the committed migration fully matches the current `admin.ts` schema.

- [ ] **Step 4: Manual smoke check (operational workflow from the design doc)**

This step has no automated assertion — it's a sanity check of the real end-to-end flow described in the design doc's "Operational workflow" section. Skip if you don't have a local Postgres/staff account handy; the automated tests already cover the logic. If you do:

1. Sign up a test account normally (gets its own personal org).
2. As a `superadmin` staff account, `POST /v1/admin/orgs/:id/billing-exemption` with a reason for that org.
3. Confirm `GET /v1/admin/orgs/:id` now shows `isBillingExempt: true`.
4. Confirm the org can start an agent session even if you manually set its `lifecycleState` to `export_window` in the DB.
5. `DELETE /v1/admin/orgs/:id/billing-exemption` and confirm the org reverts to the normal gate.

- [ ] **Step 5: Update the design doc status** (optional, if this repo's convention is to mark specs as implemented — check `docs/superpowers/specs/` for a precedent; if none exists, skip this step)

No commit needed for this task — it's verification only, not a code change.
