# Docket — Data Model / Drizzle Schema Spec (`@docket/db`)

> Implementation-grade Drizzle (Postgres) schema for every entity in the engineering plan §5. This is the **single SQL owner** for the monorepo: app tables AND Better Auth CLI-generated tables live here together. Source of truth: `docs/engineering/docket-engineering-plan.md` §5 and `docs/core/mvp-plan.md` §3–4.

## 0. Conventions (apply to ALL app tables unless noted)

### 0.1 Primary key & ID strategy

- **All PKs are `text("id").primaryKey()`** with an application-generated ID via a shared `$defaultFn`. This matches Better Auth's CLI output (`text("id").primaryKey()`) so that FK columns referencing Better Auth tables (e.g. `user.id`) are type-compatible.
- Standardize a single generator in `@docket/db/src/id.ts`:
  ```ts
  import { ulid } from 'ulid';
  export const genId = () => ulid(); // sortable, 26-char; one generator repo-wide
  ```
  Used as `.$defaultFn(genId)` on every `id` column. (Decision ULID vs cuid2 is an open issue; pick one and never mix.)
- **Do NOT use Postgres-native `uuid()`** for app tables, because Better Auth `user.id` is `text`. Mixed types break FKs.

### 0.2 Multi-tenant strategy (`organization_id`)

- **Every work-layer and org-scoped table carries `organization_id text NOT NULL REFERENCES organization.id ON DELETE CASCADE`.** This is the hard tenant boundary.
- **`organization_id` is the leading column of the primary index on every such table** (composite indexes `(organization_id, …)`), so every tenant-scoped query is index-prefixed by tenant.
- The application's data-access layer (Hono RPC + MCP) MUST inject `organization_id` into every query from the verified token context — never client-asserted (engineering plan §4).
- Cross-org tables (Hub, User, DailyPlanItem, Notification) intentionally have **no** `organization_id` on the row itself; they reference org via a nested ref column (see those tables).
- Org deletion is the lifecycle "delete" step: `ON DELETE CASCADE` from `organization` purges the org's entire work layer in one statement; external/Stripe artifacts are purged by the application lifecycle job.

### 0.3 Common columns (the "auditable entity" mixin)

A shared helper `auditColumns()` spread into work entities:

```ts
const auditColumns = () => ({
  id: text('id').primaryKey().$defaultFn(genId),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => actor.id, { onDelete: 'set null' }), // Actor
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }), // nullable = soft-delete/archive
});
```

- **Timestamps**: always `timestamp("...", { withTimezone: true })` (= `timestamptz`). `created_at`/`updated_at` default `now()`; `updated_at` uses `$onUpdate`.
- **Soft-delete / archive**: `archived_at` nullable timestamp. Active rows = `archived_at IS NULL`. Lifecycle entities that complete/cancel additionally carry `completed_at`/`canceled_at`. Hard delete only happens via org-level CASCADE during lifecycle purge.

### 0.4 Enums

- Use **Postgres native enums via `pgEnum`** for stable, cross-table value sets (status/health/priority/kind). Use Drizzle inline `text(col, { enum: [...] })` only for single-table, single-use value sets (matches Better Auth's own style for `role`).
- All `pgEnum`s declared once in `@docket/db/src/enums.ts`.

### 0.5 JSON

- `jsonb("col").$type<T>()` for structured config blobs (`preferences`, `vocabulary`, `agent_guidance`, `connection`, `provenance`, `workflow_states`, `metadata`, `before/after`). Always give a Zod-derived `$type`.

### 0.6 Polymorphic subjects

- Pattern: `subjectType <pgEnum>` + `subjectId text` (no DB FK — a polymorphic column cannot FK). App layer enforces integrity. Indexed `(organization_id, subject_type, subject_id)`.

---

## 1. Enums (`pgEnum`)

```ts
export const actorKind = pgEnum('actor_kind', ['human', 'agent', 'team']);
export const actorStatus = pgEnum('actor_status', ['active', 'suspended']);
export const initiativeStatus = pgEnum('initiative_status', ['active', 'completed']);
export const programStatus = pgEnum('program_status', ['active', 'paused', 'archived']); // NO completed
export const projectStatus = pgEnum('project_status', [
  'planned',
  'active',
  'completed',
  'canceled',
]);
export const cycleStatus = pgEnum('cycle_status', ['upcoming', 'active', 'completed']);
export const health = pgEnum('health', ['on_track', 'at_risk', 'off_track']);
export const taskPriority = pgEnum('task_priority', ['none', 'urgent', 'high', 'medium', 'low']);
export const provenanceSource = pgEnum('provenance_source', ['native', 'linked']);
export const syncMode = pgEnum('sync_mode', ['import', 'mirror']);
export const sessionTrigger = pgEnum('session_trigger', ['assignment', 'delegation', 'mention']);
export const sessionStatus = pgEnum('session_status', [
  'pending',
  'running',
  'awaiting_input',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
]);
export const sessionActivityType = pgEnum('session_activity_type', [
  'thought',
  'action',
  'response',
  'elicitation',
  'error',
]);
export const approvalStatus = pgEnum('approval_status', [
  'proposed',
  'approved',
  'rejected',
  'applied',
]);
export const approvalPolicy = pgEnum('approval_policy', [
  'suggest',
  'act_with_approval',
  'autonomous',
]);
export const grantCapability = pgEnum('grant_capability', [
  'view',
  'comment',
  'contribute',
  'assign',
  'manage',
]);
export const grantSubjectKind = pgEnum('grant_subject_kind', ['actor', 'role']);
export const resourceKind = pgEnum('resource_kind', [
  'organization',
  'team',
  'program',
  'project',
  'task',
]);
export const visibility = pgEnum('visibility', ['public', 'private']);
export const updateSubjectType = pgEnum('update_subject_type', [
  'project',
  'program',
  'initiative',
]);
export const commentSubjectType = pgEnum('comment_subject_type', [
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'update',
]);
export const notificationType = pgEnum('notification_type', [
  'approval',
  'mention',
  'assignment',
  'status',
  'comment',
  'blocker',
  'due',
]);
export const auditSubjectType = pgEnum('audit_subject_type', [
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'team',
  'actor',
  'integration',
  'session',
  'update',
  'comment',
]);
export const auditEventType = pgEnum('audit_event_type', [
  'created',
  'updated',
  'state_changed',
  'assigned',
  'delegated',
  'commented',
  'archived',
  'moved',
  'linked',
  'approved',
  'rejected',
  'member_added',
  'member_removed',
]);
export const integrationPattern = pgEnum('integration_pattern', ['migration', 'connector']);
export const integrationRole = pgEnum('integration_role', [
  'work',
  'context',
  'signal',
  'time',
  'code',
]);
export const integrationStatus = pgEnum('integration_status', [
  'connected',
  'error',
  'disconnected',
]);
export const dailyPlanItemStatus = pgEnum('daily_plan_item_status', ['planned', 'done']);
export const orgLifecycleState = pgEnum('org_lifecycle_state', [
  'trialing',
  'active',
  'past_due',
  'export_window',
  'pending_deletion',
  'deleted',
]);
export const staffRole = pgEnum('staff_role', ['support', 'finance', 'superadmin']);
```

---

## 2. Better Auth tables (CLI-generated, owned by `@docket/db`)

**Process (engineering plan §2):** run the Better Auth CLI to _generate_ the Drizzle schema **into `packages/db/src/schema/auth.ts`**, then `drizzle-kit generate`/`migrate` from `@docket/db`. `@docket/db` is the single migration owner; `@docket/auth` imports these tables, never owns them.

**Tables emitted (with the configured plugin set; all `text("id").primaryKey()`, `date`→`timestamp`, FK→`user.id` cascade):**

| Table                       | Origin                             | Notes                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                      | core                               | `id, name, email(unique), email_verified bool, image?, created_at, updated_at`. **The global account** (engineering §2: persists with zero memberships). Docket's `actor.user_id` FKs here.                                                                                                                                                               |
| `session`                   | core                               | `id, expires_at, token(unique), ip_address?, user_agent?, user_id→user`. _Better Auth login session — distinct from Docket's agent `session` table; namespaced as `authSession` in TS to avoid collision (see §5.6)._                                                                                                                                     |
| `account`                   | core                               | social/passkey/credential links: `account_id, provider_id, user_id→user, access_token?, refresh_token?, id_token?, ...`. Account-linking (Google/GitHub/Linear) writes rows here.                                                                                                                                                                         |
| `verification`              | core                               | `identifier, value, expires_at`.                                                                                                                                                                                                                                                                                                                          |
| `passkey`                   | `@better-auth/passkey`             | `id, name?, public_key, user_id→user, credential_id, counter, device_type, backed_up, transports?, created_at`.                                                                                                                                                                                                                                           |
| `ssoProvider`               | `@better-auth/sso`                 | OIDC/SAML provider configs (enterprise SSO).                                                                                                                                                                                                                                                                                                              |
| `oauthApplication`          | `oidcProvider()`                   | `id, name, icon?, metadata?, client_id(unique), client_secret?, redirect_urls, type, disabled, user_id?→user, created_at, updated_at`.                                                                                                                                                                                                                    |
| `oauthAccessToken`          | `oidcProvider()`                   | `access_token(unique), refresh_token(unique), access_token_expires_at, refresh_token_expires_at, client_id→oauthApplication.client_id, user_id?→user, scopes, ...`.                                                                                                                                                                                       |
| `oauthConsent`              | `oidcProvider()`                   | `client_id→oauthApplication.client_id, user_id→user, scopes, consent_given bool, ...`.                                                                                                                                                                                                                                                                    |
| `subscription`              | `@better-auth/stripe`              | `id, plan, reference_id (= organization.id), stripe_customer_id, stripe_subscription_id, status, period_start, period_end, cancel_at_period_end, seats?, trial_start?, trial_end?`. **Billing subject = Organization** (engineering §3); the plugin owns this table and the 4 core webhooks. Docket's lifecycle columns live on `organization`, not here. |
| `scim* / jwks` (as emitted) | `@better-auth/scim`, jwt utilities | leave as generated.                                                                                                                                                                                                                                                                                                                                       |

> The MCP plugin (`mcp()`) is built on the OIDC provider and reuses `oauthApplication`/`oauthAccessToken`/`oauthConsent` — no new tables beyond those.

**Coexistence rule:** Better Auth tables keep their generated singular names (`user`, `session`, `account`, …). Docket app tables avoid those exact names except where it owns the concept; the one true collision is the word "session" — Docket's agent session table is named **`agent_session`** (see §5.6), and Better Auth's is `session`.

---

## 3. Identity / Container layer

### 3.1 `user` — see §2 (Better Auth core). Global account; 1:1 with `hub`.

### 3.2 `hub` — personal command center (1:1 User)

```ts
export const hub = pgTable(
  'hub',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name'),
    preferences: jsonb('preferences').$type<HubPreferences>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex('hub_user_id_uq').on(t.userId)],
);
```

- **No `organization_id`** (cross-org by nature). Gathers orgs via the user's `actor` rows; owns the Personal space + DailyPlanItems + Notifications. `preferences` holds landing config, rail order/pins.

### 3.3 `organization` — shared tenant / context boundary (+ billing lifecycle)

```ts
export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    avatar: text('avatar'),
    isPersonal: boolean('is_personal').notNull().default(false),
    vocabulary: jsonb('vocabulary').$type<VocabularySkin>().notNull().default(presetStartup),
    agentGuidance: text('agent_guidance'), // org-level guidance text (team overrides; agent overrides team)
    // --- billing data-lifecycle (engineering §3; Stripe subscription row keyed by id) ---
    lifecycleState: orgLifecycleState('lifecycle_state').notNull().default('trialing'),
    exportReadyAt: timestamp('export_ready_at', { withTimezone: true }),
    deleteAfterAt: timestamp('delete_after_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('organization_slug_uq').on(t.slug),
    index('organization_lifecycle_idx').on(t.lifecycleState, t.deleteAfterAt), // cron sweep
  ],
);
```

- Personal space = `organization{ is_personal: true }` with one default team. `subscription.reference_id = organization.id` (Better Auth Stripe plugin).

### 3.4 `actor` — org-scoped "who" (folds in membership)

```ts
export const actor = pgTable(
  'actor',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: actorKind('kind').notNull(), // human | agent | team
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    status: actorStatus('status').notNull().default('active'),
    // human-only membership fields (NULL for agent/team):
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }), // FK -> Better Auth user
    roleId: text('role_id').references(() => role.id, { onDelete: 'set null' }), // named capability bundle
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('actor_org_idx').on(t.organizationId),
    // one membership row per (user, org) for human actors:
    uniqueIndex('actor_org_user_uq')
      .on(t.organizationId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
  ],
);
```

- **Assignable iff `kind ∈ {human, agent}`.** A human Actor = membership (no separate membership table). Agent identity detail lives in `agent` (§5.5), 1:1 with an `actor{kind:'agent'}`.

### 3.5 `team` — first-class within-org

```ts
export const team = pgTable(
  'team',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(), // short prefix, e.g. "MKT"
    description: text('description'),
    workflowStates: jsonb('workflow_states')
      .$type<WorkflowState[]>()
      .notNull()
      .default(defaultWorkflowStates), // [{key,name,type:'backlog'|'unstarted'|'started'|'completed'|'canceled',position}]
    triageEnabled: boolean('triage_enabled').notNull().default(true),
    agentGuidance: text('agent_guidance'), // overrides organization.agent_guidance
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('team_org_idx').on(t.organizationId),
    uniqueIndex('team_org_key_uq').on(t.organizationId, t.key),
  ],
);
```

- Team↔Actor membership: a human is a member of a team via the actor; a normalized `team_member { team_id, actor_id }` join is added (acts as the "people in a team" set). Workflow states embedded as jsonb (Task.state references a `state.key`).

```ts
export const teamMember = pgTable(
  'team_member',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.actorId] }),
    index('team_member_actor_idx').on(t.actorId),
  ],
);
```

---

## 4. Work layer

### 4.1 `initiative` (theme; no work inside; m2m to projects+programs)

```ts
export const initiative = pgTable(
  'initiative',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id').references(() => actor.id, { onDelete: 'set null' }),
    status: initiativeStatus('status').notNull().default('active'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    health: health('health'), // nullable; derived from latest Update
  },
  (t) => [index('initiative_org_idx').on(t.organizationId)],
);
```

### 4.2 `program` (ongoing ops; NO completed status)

```ts
export const program = pgTable(
  'program',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id').references(() => actor.id, { onDelete: 'set null' }),
    status: programStatus('status').notNull().default('active'), // active|paused|archived
    health: health('health'),
  },
  (t) => [index('program_org_idx').on(t.organizationId)],
);
```

### 4.3 `project` (bounded; under org or under a program)

```ts
export const project = pgTable(
  'project',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    leadId: text('lead_id').references(() => actor.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => program.id, { onDelete: 'set null' }), // optional
    teamId: text('team_id').references(() => team.id, { onDelete: 'set null' }),
    status: projectStatus('status').notNull().default('planned'),
    health: health('health'),
    startDate: timestamp('start_date', { withTimezone: true }),
    targetDate: timestamp('target_date', { withTimezone: true }),
  },
  (t) => [
    index('project_org_idx').on(t.organizationId),
    index('project_program_idx').on(t.programId),
    index('project_team_idx').on(t.teamId),
  ],
);
```

### 4.4 `cycle` (team-scoped recurring window)

```ts
export const cycle = pgTable(
  'cycle',
  {
    ...auditColumns(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: cycleStatus('status').notNull().default('upcoming'),
  },
  (t) => [
    index('cycle_team_idx').on(t.teamId),
    uniqueIndex('cycle_team_number_uq').on(t.teamId, t.number),
  ],
);
```

### 4.5 `task` (atomic unit; project optional; provenance inline)

```ts
export const task = pgTable(
  'task',
  {
    ...auditColumns(),
    title: text('title').notNull(),
    description: text('description'),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'restrict' }), // always a team
    state: text('state').notNull(), // key into team.workflow_states (per-team, no global FK)
    priority: taskPriority('priority').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => actor.id, { onDelete: 'set null' }), // Human|Agent
    delegateId: text('delegate_id').references(() => actor.id, { onDelete: 'set null' }), // Agent ("you own, agent does")
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => program.id, { onDelete: 'set null' }),
    milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references((): any => task.id, { onDelete: 'cascade' }), // subtask tree
    estimate: integer('estimate'), // optional unit, off by default
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    // provenance:
    provenanceSource: provenanceSource('provenance_source').notNull().default('native'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    provenanceSyncMode: syncMode('provenance_sync_mode'), // import|mirror when linked
  },
  (t) => [
    index('task_org_idx').on(t.organizationId),
    index('task_team_state_idx').on(t.teamId, t.state),
    index('task_project_idx').on(t.projectId),
    index('task_program_idx').on(t.programId),
    index('task_cycle_idx').on(t.cycleId),
    index('task_assignee_idx').on(t.assigneeId),
    index('task_parent_idx').on(t.parentTaskId),
    uniqueIndex('task_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`), // idempotent import/mirror
  ],
);
```

- "Triage" = a Task with `project_id IS NULL AND program_id IS NULL` on a team with `triage_enabled` (derived, not a column).
- `assignee` and `delegate` MUST point at actors with `kind ∈ {human, agent}` / `kind = agent` respectively — enforced in the app layer.

### 4.6 `milestone` (dated checkpoint attribute of a Project — real table)

```ts
export const milestone = pgTable(
  'milestone',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetDate: timestamp('target_date', { withTimezone: true }),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('milestone_project_idx').on(t.projectId)],
);
```

---

## 5. Agents & Sessions

### 5.5 `agent` (1:1 with an `actor{kind:'agent'}`; thin identity)

```ts
export const agent = pgTable(
  'agent',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .unique()
      .references(() => actor.id, { onDelete: 'cascade' }),
    connection: jsonb('connection').$type<AgentConnection>().notNull(), // {endpoint, protocol, credentialsRef} — provider Athena/Claude/Codex
    approvalPolicy: approvalPolicy('approval_policy').notNull().default('suggest'), // suggest|act_with_approval|autonomous
    accountableOwnerId: text('accountable_owner_id').references(() => actor.id, {
      onDelete: 'set null',
    }),
    guidance: text('guidance'), // per-agent override (top of org<team<agent layering)
    approvalRouting: jsonb('approval_routing').$type<ApprovalRouting>(), // org/team override of "approver = assigner"
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('agent_org_idx').on(t.organizationId)],
);
```

- **Two separate dials** (product §4): _what it may touch_ = `grant` rows to the agent actor (same permission system, §6.1); _whether writes need sign-off_ = `approval_policy`. **Cost/compute/telemetry NOT stored** (provider owns it).

### 5.6 `agent_session` (Docket-hosted episode — the real entity)

```ts
export const agentSession = pgTable(
  'agent_session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
    trigger: sessionTrigger('trigger').notNull(), // assignment|delegation|mention
    status: sessionStatus('status').notNull().default('pending'),
    externalRunRef: text('external_run_ref'), // provider's run id
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_session_org_idx').on(t.organizationId),
    index('agent_session_task_idx').on(t.taskId),
    index('agent_session_status_idx').on(t.organizationId, t.status), // Agents feed filter
  ],
);
```

> TS export name `agentSession`; table name `agent_session` — deliberately NOT `session` (that's Better Auth's login session, §2).

### 5.7 `session_activity` (per-session stream; distinct from org audit feed)

```ts
export const sessionActivity = pgTable(
  'session_activity',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    type: sessionActivityType('type').notNull(), // thought|action|response|elicitation|error
    body: jsonb('body').$type<SessionActivityBody>().notNull(),
    // approval (only meaningful when type='action' under act_with_approval):
    approvalStatus: approvalStatus('approval_status'), // proposed|approved|rejected|applied
    appliedAuditEventId: text('applied_audit_event_id').references((): any => auditEvent.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('session_activity_session_idx').on(t.sessionId, t.createdAt),
    index('session_activity_approval_idx')
      .on(t.approvalStatus)
      .where(sql`${t.approvalStatus} = 'proposed'`),
  ],
);
```

- `response`/`elicitation` activities are mirrored into the Task `comment` stream by posting a `comment` authored by the agent's actor (product §4 / engineering §5).

---

## 6. Cross-cutting

### 6.1 `role`, `grant` (granular permissions; agent scopes use same system)

```ts
export const role = pgTable(
  'role',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Owner|Admin|Member|Guest (+ custom)
    isSystem: boolean('is_system').notNull().default(false),
    capabilities: jsonb('capabilities').$type<GrantCapability[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('role_org_name_uq').on(t.organizationId, t.name)],
);

export const grant = pgTable(
  'grant',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectKind: grantSubjectKind('subject_kind').notNull(), // actor | role
    subjectId: text('subject_id').notNull(), // actor.id or role.id (polymorphic; app-enforced)
    resourceKind: resourceKind('resource_kind').notNull(), // organization|team|program|project|task
    resourceId: text('resource_id').notNull(), // polymorphic; app-enforced
    capabilities: jsonb('capabilities').$type<GrantCapability[]>().notNull(), // view|comment|contribute|assign|manage
    visibility: visibility('visibility').notNull().default('public'),
  },
  (t) => [
    index('grant_org_idx').on(t.organizationId),
    index('grant_subject_idx').on(t.organizationId, t.subjectKind, t.subjectId),
    index('grant_resource_idx').on(t.organizationId, t.resourceKind, t.resourceId),
    uniqueIndex('grant_uq').on(t.subjectKind, t.subjectId, t.resourceKind, t.resourceId),
  ],
);
```

- Grants **cascade down containment** (org→team/program→project→task), overridable lower — resolution is application logic. **Agent scopes = grants whose `subject_kind='actor'` and subject is an agent actor.** Default visibility: public to org members, guests are grant-only (resolution layer).

### 6.2 `update` (status post; latest sets subject health)

```ts
export const update = pgTable(
  'update',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => actor.id, { onDelete: 'set null' }),
    subjectType: updateSubjectType('subject_type').notNull(), // project|program|initiative
    subjectId: text('subject_id').notNull(),
    health: health('health').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('update_subject_idx').on(t.organizationId, t.subjectType, t.subjectId, t.createdAt),
  ],
);
```

### 6.3 `daily_plan_item` (Hub-scoped, personal, cross-org)

```ts
export const dailyPlanItem = pgTable(
  'daily_plan_item',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    date: date('date').notNull(), // calendar day, no tz
    refOrganizationId: text('ref_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    refTaskId: text('ref_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
    status: dailyPlanItemStatus('status').notNull().default('planned'),
    timebox: jsonb('timebox').$type<{ start: string; end: string }>(), // optional calendar timebox
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('daily_plan_item_hub_date_idx').on(t.hubId, t.date),
    uniqueIndex('daily_plan_item_uq').on(t.hubId, t.date, t.refTaskId),
  ],
);
```

- **No `organization_id` on the row** (Hub is cross-org); org is carried as `ref_organization_id` for the org-chip. `task_ref` = `(ref_organization_id, ref_task_id)` pair from the engineering doc.

### 6.4 `notification` (cross-org; backs Hub Inbox)

```ts
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }), // which org it's from
    type: notificationType('type').notNull(), // approval|mention|assignment|status|comment|blocker|due
    subjectType: auditSubjectType('subject_type').notNull(), // polymorphic
    subjectId: text('subject_id').notNull(),
    body: jsonb('body').$type<NotificationBody>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('notification_inbox_idx').on(t.userId, t.readAt, t.actedAt, t.createdAt), // Inbox = unread/unacted across orgs
    index('notification_org_idx').on(t.organizationId),
  ],
);
```

### 6.5 `integration` (org-scoped)

```ts
export const integration = pgTable(
  'integration',
  {
    ...auditColumns(),
    provider: text('provider').notNull(), // github|drive|gmail|calendar|linear|jira|asana
    pattern: integrationPattern('pattern').notNull(), // migration|connector
    roles: integrationRole('roles')
      .array()
      .notNull()
      .default(sql`'{}'`), // work|context|signal|time|code (pg enum[])
    connection: jsonb('connection').$type<IntegrationConnection>().notNull(), // {credentialsRef, account}
    status: integrationStatus('status').notNull().default('connected'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    syncMode: syncMode('sync_mode').notNull(), // import|mirror
  },
  (t) => [index('integration_org_idx').on(t.organizationId)],
);
```

### 6.6 `label` (org-scoped, optional team scope; m2m Task)

```ts
export const label = pgTable(
  'label',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(), // hex
    group: text('group'),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }), // optional team scope
  },
  (t) => [
    index('label_org_idx').on(t.organizationId),
    uniqueIndex('label_org_name_uq').on(t.organizationId, t.name), // (open issue: per-org vs per-team uniqueness)
  ],
);
```

### 6.7 `comment` (polymorphic subject; agents post as their actor)

```ts
export const comment = pgTable(
  'comment',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => actor.id, { onDelete: 'set null' }), // Actor (human or agent)
    subjectType: commentSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    body: text('body').notNull(),
    parentCommentId: text('parent_comment_id').references((): any => comment.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    index('comment_subject_idx').on(t.organizationId, t.subjectType, t.subjectId, t.createdAt),
    index('comment_parent_idx').on(t.parentCommentId),
  ],
);
```

### 6.8 `audit_event` (org-wide Activity feed / audit log)

```ts
export const auditEvent = pgTable(
  'audit_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }), // principal
    initiatorId: text('initiator_id').references(() => actor.id, { onDelete: 'set null' }), // agent set-in-motion-by
    subjectType: auditSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    type: auditEventType('type').notNull(), // created|state_changed|assigned|commented|...
    metadata: jsonb('metadata').$type<{ before?: unknown; after?: unknown }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_event_org_idx').on(t.organizationId, t.createdAt),
    index('audit_event_subject_idx').on(t.organizationId, t.subjectType, t.subjectId, t.createdAt),
  ],
);
```

- Distinct from `session_activity` (per-agent stream) despite the shared product word "activity."

---

## 7. Join / edge tables

### 7.1 `initiative_project` (m2m theme link)

```ts
export const initiativeProject = pgTable(
  'initiative_project',
  {
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.projectId] }),
    index('initiative_project_project_idx').on(t.projectId),
  ],
);
```

### 7.2 `initiative_program` (m2m theme link)

```ts
export const initiativeProgram = pgTable(
  'initiative_program',
  {
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => program.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.programId] }),
    index('initiative_program_program_idx').on(t.programId),
  ],
);
```

### 7.3 `task_label` (m2m Task↔Label)

```ts
export const taskLabel = pgTable(
  'task_label',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index('task_label_label_idx').on(t.labelId),
  ],
);
```

### 7.4 `task_dependency` (directed, acyclic, org-wide, cross-project)

```ts
export const taskDependency = pgTable(
  'task_dependency',
  {
    blockingTaskId: text('blocking_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    blockedTaskId: text('blocked_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockingTaskId, t.blockedTaskId] }),
    index('task_dependency_blocked_idx').on(t.blockedTaskId), // surface "blocked by"
    // self-edge guard:
    check('task_dependency_no_self', sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
  ],
);
```

**Acyclic enforcement (no single Postgres constraint can do this):**

1. `CHECK(blocking <> blocked)` blocks the trivial 1-cycle (above).
2. `PK(blocking, blocked)` blocks duplicate edges.
3. **Before INSERT**, run a recursive-CTE reachability check inside a `SERIALIZABLE` (or at minimum `REPEATABLE READ`) transaction: reject if `blocked_task_id` can already reach `blocking_task_id` along existing `blocks` edges. Pseudocode:
   ```sql
   WITH RECURSIVE reach AS (
     SELECT blocked_task_id AS n FROM task_dependency
       WHERE blocking_task_id = $blocked AND organization_id = $org
     UNION
     SELECT d.blocked_task_id FROM task_dependency d
       JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = $org
   )
   SELECT 1 FROM reach WHERE n = $blocking; -- if any row, INSERT would create a cycle → reject
   ```
   Both tasks MUST share `organization_id` (dependencies are org-wide but never cross-tenant). Optionally back this with a deferred constraint trigger for defense-in-depth.

---

## 8. Service-admin layer (service-level; NOT per-org tenant data)

These tables have **no `organization_id` tenant scoping** in the multi-tenant sense — they reference orgs/users but belong to Docket-the-business, and are excluded from the org lifecycle CASCADE purge.

### 8.1 `staff_user`

```ts
export const staffUser = pgTable(
  'staff_user',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull(), // support|finance|superadmin
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('staff_user_user_uq').on(t.userId)],
);
```

### 8.2 `impersonation_session` (time-boxed, reason-logged "View as")

```ts
export const impersonationSession = pgTable(
  'impersonation_session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    staffUserId: text('staff_user_id')
      .notNull()
      .references(() => staffUser.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'cascade' }),
    targetOrgId: text('target_org_id').references(() => organization.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('impersonation_staff_idx').on(t.staffUserId),
    check(
      'impersonation_target_present',
      sql`${t.targetUserId} IS NOT NULL OR ${t.targetOrgId} IS NOT NULL`,
    ),
  ],
);
```

### 8.3 `lifecycle_hold` (pauses trial→export→delete pipeline)

```ts
export const lifecycleHold = pgTable(
  'lifecycle_hold',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    placedBy: text('placed_by')
      .notNull()
      .references(() => staffUser.id, { onDelete: 'restrict' }),
    placedAt: timestamp('placed_at', { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }), // active hold = NULL
  },
  (t) => [
    index('lifecycle_hold_org_idx')
      .on(t.organizationId)
      .where(sql`${t.releasedAt} IS NULL`),
  ],
);
```

- The lifecycle cron sweep MUST skip orgs with an active `lifecycle_hold`.

### 8.4 `operator_audit_event` (operator actions; distinct from per-org audit feed)

```ts
export const operatorAuditEvent = pgTable(
  'operator_audit_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    staffUserId: text('staff_user_id').references(() => staffUser.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // extend_trial|credit|refund|change_plan|pause_dunning|view_as|...
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    targetOrgId: text('target_org_id').references(() => organization.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('operator_audit_created_idx').on(t.createdAt)],
);
```

---

## 9. Package layout (`@docket/db`)

```
packages/db/
├─ src/
│  ├─ id.ts            genId()
│  ├─ enums.ts         all pgEnum()
│  ├─ types.ts         Zod-derived $type<> interfaces (preferences, vocabulary, connection, ...)
│  ├─ schema/
│  │  ├─ auth.ts       Better Auth CLI-GENERATED (user/session/account/verification/passkey/
│  │  │               oauthApplication/oauthAccessToken/oauthConsent/subscription/sso/scim/jwks)
│  │  ├─ identity.ts   hub, organization, actor, team, teamMember
│  │  ├─ work.ts       initiative, program, project, cycle, task, milestone
│  │  ├─ agents.ts     agent, agentSession, sessionActivity
│  │  ├─ crosscutting.ts role, grant, update, dailyPlanItem, notification,
│  │  │                  integration, label, comment, auditEvent
│  │  ├─ joins.ts      initiativeProject, initiativeProgram, taskLabel, taskDependency
│  │  └─ admin.ts      staffUser, impersonationSession, lifecycleHold, operatorAuditEvent
│  ├─ relations.ts     drizzle relations() for all of the above
│  └─ index.ts         re-export everything; export `schema` object for drizzle()
├─ drizzle.config.ts   { schema: "./src/schema", dialect: "postgresql", out: "./drizzle" }
└─ package.json        compiled (tsc → dist) per engineering §1
```

- `@docket/db` is the **single migration owner**: `drizzle-kit generate` + `drizzle-kit migrate` run only here. Better Auth's CLI writes `schema/auth.ts`; Docket never hand-edits generated tables, only re-runs the CLI on plugin/version changes.
- Neon serverless driver in prod, node-postgres in local dev — same schema, env-var-only connection string (`DATABASE_URL`). Dev mirrors prod (engineering §0.3).

---

## 10. Entity-Relationship Summary

```
user (BetterAuth, global) ─1:1─ hub
user ─1:N─ actor (kind=human; membership) ─N:1─ organization
organization ─1:N─ team ─1:N─ cycle
team ─M:N─ actor (via team_member)
organization ─1:N─ {initiative, program, project, task, label, integration, role, grant, comment, update, audit_event, agent}

program ─1:N─ project ─1:N─ milestone
project ─1:N─ task ;  program ─1:N─ task ;  team ─1:N─ task (task.team_id NOT NULL)
task ─self─ task (parent_task_id; subtasks)
task ─N:1─ cycle ;  task ─N:1─ milestone
task.assignee_id / delegate_id ─N:1─ actor (human|agent / agent)
task ─N:1─ integration (provenance.source_integration_id)

initiative ─M:N─ project   (initiative_project)
initiative ─M:N─ program   (initiative_program)
task ─M:N─ label           (task_label)
task ─DAG─ task            (task_dependency: blocking→blocked, acyclic, org-wide)

actor(kind=agent) ─1:1─ agent ─1:N─ agent_session ─1:N─ session_activity
agent_session ─N:1─ task
session_activity.applied_audit_event_id ─N:1─ audit_event   (agent action → audit row)

hub ─1:N─ daily_plan_item ─(ref pair)→ organization + task   (cross-org)
user ─1:N─ notification ─N:1─ organization                   (cross-org Inbox)

organization ─1:1─ subscription (BetterAuth Stripe; reference_id = organization.id)
organization.lifecycle_state/export_ready_at/delete_after_at  (Docket-owned lifecycle)

[service-admin, no tenant scope]
user ─1:1─ staff_user ─1:N─ impersonation_session, lifecycle_hold(placed_by), operator_audit_event
lifecycle_hold ─N:1─ organization  (pauses lifecycle sweep)
```

### Cardinality / containment vs. association cheat sheet (product §3)

- **Containment (hard parent, `ON DELETE CASCADE`):** organization→{team, initiative, program, project, task, …}; program→project; project→{milestone, task(set null on detach)}; agent→agent_session; agent_session→session_activity; task→subtask.
- **Association (soft, `ON DELETE SET NULL` or m2m):** initiative↔project/program (m2m); cycle→task (set null); milestone→task (set null); task↔task blocks (m2m DAG); label↔task (m2m).
