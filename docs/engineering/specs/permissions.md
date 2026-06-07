## Docket — Permissions & Authorization Spec (implementation-grade)

> Source of truth: `docs/core/mvp-plan.md` (§4 Actors & Agents, §8.7 Settings, §8.3 Saved Views) and `docs/engineering/docket-engineering-plan.md` (§5 Data Model — Permission/Grant, Actor, Role, Agent). This spec makes the authorization model exact enough to build without inventing decisions. All names match the engineering data model.

### 0. Scope & non-goals

This area defines **authorization only**: given an authenticated principal, may it perform a capability on a resource, and which rows may it see. It does **not** cover:

- **Authentication / identity** (Better Auth, sessions, passkeys) — see `auth-identity`. This spec consumes a resolved `User.id` from a verified session, or a verified MCP token `sub` (see §10).
- **Billing-state gating** (e.g. `lifecycleState = pending_deletion` blocking writes) — that gate runs _before_ this layer; treat a frozen org as a separate 402/403 concern.
- **Service-admin / operator authorization** (`StaffUser`, `ImpersonationSession`) — a _separate_ authorization plane (§11), never mixed with tenant authorization.

#### 0.1 Critical architectural decision: custom engine, NOT Better Auth org-plugin AC

Better Auth 1.6.14 ships `createAccessControl()` / `ac.newRole()` / `hasPermission()` / `checkRolePermission()` (verified against current docs). That model is **flat**: a role maps `resource → action[]`, with no containment cascade, no per-resource-instance grants, and no row-level visibility filtering. Docket's model in the engineering doc requires all three (cascade down Org→Team/Program→Project→Task, instance-level `Grant` rows, role-dependent default visibility).

**Decision:** Docket implements its **own** permission engine over its own `role` and `permission_grant` tables (this spec). Better Auth is used for **identity/session/membership-of-record only**. We do **not** delegate cascade or visibility to Better Auth AC. The engineering doc already folds membership into the `Actor` table (`user_id` + `role` on a human Actor, no separate Membership table), which is consistent with this: `Actor.role` is an FK into Docket's `role` table, not a Better Auth role string.

> Implementers must NOT wire `organization({ ac, roles })` for work-layer authorization. (Better Auth's own `member`/`invitation`/`organization` statements may still govern _membership-management_ endpoints if the org plugin is adopted for invites; that is orthogonal and out of scope here.)

---

### 1. The capability set

Five capabilities, ordered as a **strict implication chain**. A higher capability implies every lower one. They are stored/compared by ordinal.

| Capability   | Ordinal | Grants the holder the ability to…                                                                                                   | Implies                                   |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `view`       | 1       | read the resource and its children (subject to visibility); appear in list results                                                  | —                                         |
| `comment`    | 2       | post Comments + Updates; react; participate in Session elicitation threads                                                          | `view`                                    |
| `contribute` | 3       | create/edit/move/complete work _content_ (Task fields, descriptions, milestones, labels, dependencies); create child Tasks/Projects | `comment`, `view`                         |
| `assign`     | 4       | set `assignee_id` / `delegate_id`; trigger an Agent Session on a resource; approve/reject agent actions when routed (see §9)        | `contribute`, `comment`, `view`           |
| `manage`     | 5       | edit resource settings, manage Grants/roles on the resource and its subtree, archive/delete, change visibility                      | `assign`, `contribute`, `comment`, `view` |

```ts
// @docket/types
export const CAPABILITIES = ['view', 'comment', 'contribute', 'assign', 'manage'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_RANK: Record<Capability, number> = {
  view: 1,
  comment: 2,
  contribute: 3,
  assign: 4,
  manage: 5,
};
/** A holder with `held` satisfies a requirement for `required` iff held outranks-or-equals required. */
export const satisfies = (held: Capability, required: Capability): boolean =>
  CAPABILITY_RANK[held] >= CAPABILITY_RANK[required];
```

A **capability set** carried by a Grant or a role bundle is stored as the _maximum_ capability granted (the chain makes a set redundant — holding `assign` is exactly the set `{view,comment,contribute,assign}`). To preserve forward-compatibility with possibly non-monotonic future capabilities, the column is a typed array `Capability[]`, but the v1 resolver collapses it to its max via `CAPABILITY_RANK`. **Implementers: store the array; resolve by max-rank.**

---

### 2. Resource hierarchy (containment chain)

Authorization cascades down **containment** edges only (never association edges — Initiatives, Cycles, dependency `blocks` edges do NOT carry permission). The chain, from the engineering model:

```
Organization
  ├─ Team        (first-class; owns Cycles + Triage)
  ├─ Program     (ongoing ops)
  │     └─ Project
  │           └─ Task
  ├─ Project     (may sit directly under Org)
  │     └─ Task
  └─ Task        (Triage — directly under Org/Team, no Project)
```

**Resource types under authorization** (the `resource_type` enum):

```ts
export const RESOURCE_TYPES = ['organization', 'team', 'program', 'project', 'task'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
```

> Initiative, Cycle, Update, Comment, Session, View, Label are **NOT** independently grantable resource types. Their authorization derives from a containing grantable resource:
>
> - **Initiative**: org-level theme; treated as an `organization`-scoped object — visible to anyone with `view` on the Org; editable with `manage` on the Org (or an Initiative-`owner_id` override, see §6.4). Initiatives contain no work, so they carry no Task-level permission.
> - **Cycle**: derives from its `team` (Cycle is team-scoped). `view`/`contribute` on the Team.
> - **Update / Comment**: derive from their polymorphic `subject` resource (the Project/Program/Initiative/Task they attach to). Authoring requires `comment` on the subject.
> - **Session / Session Activity**: derive from the Session's `task_id` resource (or, if no task, the Org). See §9.
> - **Saved View**: the View _definition_ is Org-member metadata; its _results_ are always re-scoped per requester (§7.4). A View is not a grantable resource.
> - **Label**: org/team metadata; `contribute` on a Task lets you attach existing Labels; creating Labels needs `manage` on Team or Org.

#### 2.1 Resolving a resource's containment ancestors

Every grantable resource resolves to an ordered ancestor list **root→self** (most-general first). The resolver walks FKs:

- `task` → `project_id?` → (`project.program_id?`) ; if no project, `team_id` ; always → `organization_id`
- `project` → `program_id?` → `team_id?` → `organization_id`
- `program` → `organization_id`
- `team` → `organization_id`
- `organization` → (root)

A Task's chain is therefore one of:
`[org, team?, program?, project, task]` (full) or `[org, team, task]` (Triage task) — `team` is included when `task.team_id` is set (it always is, per model rule §3.3: a Task always belongs to a Team).

```ts
/** Ordered root→self. Used by both the resolver and query-scoping. */
async function ancestorChain(db, resource: ResourceRef): Promise<ResourceRef[]> {
  /* FK walk, see §2.1 */
}
```

**Performance note:** the chain is bounded (≤5 hops) and resolvable in one query using a Postgres recursive CTE or, preferred for hot paths, a denormalized `ancestor_path` materialization (see §7.3). Do not issue 5 sequential round-trips per check.

---

### 3. The Grant record

A `permission_grant` row binds a **subject** (an Actor _or_ a role) to a **resource instance** with a capability set, an effect, and propagation.

```ts
// packages/db — drizzle schema (illustrative; align column casing with db conventions)
export const permissionGrant = pgTable(
  'permission_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),

    // SUBJECT — exactly one of (actorId) or (roleId) is non-null (CHECK constraint).
    subjectKind: text('subject_kind', { enum: ['actor', 'role'] }).notNull(),
    actorId: uuid('actor_id').references(() => actor.id), // when subjectKind='actor' (humans AND agents)
    roleId: uuid('role_id').references(() => role.id), // when subjectKind='role'

    // RESOURCE — polymorphic instance.
    resourceType: text('resource_type', { enum: RESOURCE_TYPES }).notNull(),
    resourceId: uuid('resource_id').notNull(), // FK enforced per-type by app layer; org row uses organizationId

    // CAPABILITY + EFFECT
    capabilities: text('capabilities', { enum: CAPABILITIES }).array().notNull(), // resolve by max-rank
    effect: text('effect', { enum: ['allow', 'deny'] })
      .notNull()
      .default('allow'),

    // PROPAGATION
    cascades: boolean('cascades').notNull().default(true), // applies to the resource AND its containment subtree
    visibilityOverride: text('visibility_override', { enum: ['public', 'private'] }), // null = inherit; see §5

    createdBy: uuid('created_by')
      .references(() => actor.id)
      .notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'), // optional time-boxed grant (e.g. temporary guest access)
  },
  (t) => [
    // one effective grant per (subject, resource, effect)
    uniqueIndex('grant_subject_resource_uq').on(
      t.subjectKind,
      t.actorId,
      t.roleId,
      t.resourceType,
      t.resourceId,
      t.effect,
    ),
    index('grant_actor_idx').on(t.organizationId, t.actorId),
    index('grant_role_idx').on(t.organizationId, t.roleId),
    index('grant_resource_idx').on(t.resourceType, t.resourceId),
  ],
);
```

Semantics:

- **`cascades = true`** (default): the grant applies to the named resource _and_ every resource in its containment subtree, **overridable lower** (a more-specific grant on a descendant supersedes — §4.4). `cascades = false` pins the grant to exactly that one resource (rare; used for "view this single Task but nothing else in the Project").
- **`effect = deny`**: an explicit deny that subtracts capability. Used to lock a member out of one sensitive subtree while leaving the org-wide role intact. **Most-specific deny wins** within the precedence order (§4.4). (Open issue: DENY may be deferred from v1 — allow-only is simpler. The resolver supports it; the UI may not expose it in v1.)
- **`visibilityOverride`**: an instance-level visibility flip (e.g. make one Project `public` inside an otherwise members-only context, or `private` to hide it) — see §5.
- **`expiresAt`**: when set and `< now()`, the grant is inert (filtered out at query time and ignored by the resolver). Powers time-boxed guest access.

**Role grants vs Actor grants.** A grant whose `subjectKind='role'` is the storage form of a **role bundle's default capabilities** _for resources it is attached to_. In practice the four seeded role bundles attach their defaults at the **Org root** (resourceType=`organization`, resourceId=org.id, cascades=true) — that is literally how "a Member can `contribute` org-wide" is represented. Actor grants are individual overrides/additions on top.

---

### 4. Role bundles

`role` is an org-scoped named capability bundle (engineering model §5). Four are **seeded per org** at creation; custom roles are additional rows.

```ts
export const role = pgTable(
  'role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    key: text('key').notNull(), // 'owner' | 'admin' | 'member' | 'guest' | custom slug
    name: text('name').notNull(), // display (honors vocabulary skin)
    isSystem: boolean('is_system').notNull().default(false), // the 4 seeded bundles
    // default capability this role confers org-wide (materialized as a role-grant at the Org root):
    baseCapability: text('base_capability', { enum: CAPABILITIES }), // null for guest
    defaultVisibility: text('default_visibility', { enum: ['public', 'private'] }).notNull(), // §5
  },
  (t) => [uniqueIndex('role_org_key_uq').on(t.organizationId, t.key)],
);
```

`actor.role_id` FK references `role.id` (the human Actor's role-of-membership). Agents do **not** carry a role (`actor.role_id` is null for `kind='agent'`); agents are authorized purely by Actor-grants (§8).

#### 4.1 Seeded role defaults

| Role       | `key`    | Org-wide base capability | Default visibility (§5) | Notes                                                                                                                                                                                                                                                                             |
| ---------- | -------- | ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**  | `owner`  | `manage`                 | `public`                | Full control incl. billing reference, deleting the org, transferring ownership, managing all roles/grants. At least one Owner always exists (last-owner guard, §4.5).                                                                                                             |
| **Admin**  | `admin`  | `manage`                 | `public`                | Same capability surface as Owner over work + members, **minus** org-deletion, ownership transfer, and billing subject changes. The capability is `manage`; the Owner-only powers are gated by an additional `is_org_privileged_action` check (§4.5), not by the capability chain. |
| **Member** | `member` | `contribute`             | `public`                | Sees all `public` work in the org; can create/edit/complete work; cannot manage org settings, roles, or grants beyond resources where they hold an explicit `manage` grant.                                                                                                       |
| **Guest**  | `guest`  | `null` (no base)         | `private`               | **Grant-only.** No org-wide capability whatsoever. Sees _nothing_ until an explicit Actor-grant names a resource. This is the product's "Guests… see nothing until granted" (mvp-plan §8.7).                                                                                      |

The org-wide base is materialized as a role-grant at the Org root: `permission_grant { subjectKind:'role', roleId, resourceType:'organization', resourceId:org.id, capabilities:[baseCapability], cascades:true, effect:'allow' }`. **Guest gets no such row** (its `baseCapability` is null), which is exactly what makes guests grant-only.

#### 4.2 Owner vs Admin — the privileged-action gate

Both hold `manage`, so the capability resolver alone cannot distinguish them. A small fixed list of **org-privileged actions** requires `role.key === 'owner'` in addition to `manage`:

```ts
const OWNER_ONLY = new Set([
  'org.delete',
  'org.transfer_ownership',
  'org.change_billing_subject',
  'role.modify_system_role', // editing the Owner/Admin/Member/Guest bundles themselves
]);
```

Everything else (managing members, creating custom roles, managing grants on any subtree, archiving Projects, etc.) is plain `manage`.

#### 4.3 Custom roles

Custom roles are additional `role` rows with `isSystem=false`, any `baseCapability` (≤ the creator's own org-wide capability — you cannot mint a role more powerful than yourself, mirroring Better Auth's "cannot add permissions your role can't access" rule), and any `defaultVisibility`. They behave identically to system roles in resolution.

#### 4.4 Precedence (how conflicting grants combine)

When multiple grants apply to a (actor, resource), resolve in this strict order. **Specificity beats generality; within equal specificity, deny beats allow; actor beats role.**

1. Compute the actor's **applicable grant set**: every non-expired grant where the subject is the actor **or** a role the actor holds, and whose resource is the target **or** a containment-ancestor of the target with `cascades=true`, **or** the target itself.
2. For each grant, compute its **specificity** = the index of its resource in the target's root→self ancestor chain (Org=0 … Task=N). Higher index = more specific.
3. Determine the **winning specificity level** = the highest level at which _any_ grant applies.
4. **Within that level:** if any `deny` grant exists → the effective capability contributed by that level is reduced (deny removes the denied capabilities). Otherwise take the **max** allow capability at that level, preferring an actor-subject grant over a role-subject grant when ranks tie.
5. **Carry-down with override:** a more-specific level _overrides_ a less-specific one for the capabilities it speaks to. A descendant grant that grants `view` only does **not** silently strip an inherited `contribute` _unless_ it is a `deny`. Concretely: start from the least-specific effective capability and, at each more-specific level that has a grant, **replace** the effective capability with that level's resolved capability (allow) or **subtract** (deny). Levels with no grant are pass-through.
6. The final effective capability for the target is the result of the walk. `allow` iff `satisfies(effective, required)`.

> Plain-English: org-role gives you a baseline everywhere; a Project-level grant can raise or lower you on that Project's subtree; a deny anywhere in the chain at-or-above the target can lock you out; the closest-to-the-target grant wins ties.

#### 4.5 Invariants

- **Last-owner guard:** an org must always have ≥1 active human Actor with `role.key='owner'`. Removing/downgrading the last Owner is rejected.
- **Personal space:** `Organization{is_personal:true}` seeds its single User as Owner; invitations/guests are rejected (single-Actor org). (Open issue — confirm.)
- **No self-escalation:** an actor cannot create/modify a grant or role conferring a capability greater than the actor's own effective capability on that resource (checked at write time on grant/role mutation endpoints).

---

### 5. Visibility (role-dependent default)

Visibility answers a _different_ question than capability: **"does this resource appear at all for actors who have no grant on it?"** It is what makes "members see public, guests see nothing" work without an explicit grant per member per resource.

Each grantable resource has an **effective visibility** ∈ `{public, private}`, resolved as:

1. The nearest ancestor-or-self grant with a non-null `visibilityOverride` (most-specific wins) — explicit per-resource visibility.
2. Else, the resource's own stored `visibility` column (Project/Program/Team/Task carry an optional `visibility {public, private}` per the engineering model's Permission/Grant note; default `public` for native work).
3. Else `public`.

**The visibility → access rule:**

- A resource with effective visibility **`public`** is **viewable by any Actor whose role's `defaultVisibility` is `public`** (i.e. Members/Admins/Owners) _without needing a grant_. This is the "members see public" default.
- A resource with effective visibility **`private`**, OR any resource at all for an actor whose role `defaultVisibility` is `private` (**Guests**), is **viewable only via an explicit allowing grant** resolving to ≥`view`.

```ts
function visibilityGrantsView(actor: ResolvedActor, target: ResourceRef, db): boolean {
  const eff = effectiveVisibility(target, db); // §5 steps 1–3
  if (actor.roleDefaultVisibility === 'private') return false; // guests: never by visibility
  return eff === 'public'; // members+: public is visible by default
}
```

Visibility only ever confers **`view`** (appearing + reading). Any capability above `view` always requires a grant or role base capability. So a Member sees all public work (`view`) and, via their `member` org-base grant of `contribute`, can also edit public work — but a Guest with a `view`-only grant on one Project sees and reads only that Project's subtree and can do nothing else.

---

### 6. The resolution algorithm (pseudocode)

The single authoritative entry point. **Server-side only.** Input `(actor, capability, resource)` → `allow | deny`.

```ts
/**
 * canActor — the one authorization decision function. Pure given its db reads.
 * @returns ResolveResult { allow: boolean; reason: string; effectiveCapability: Capability | null }
 */
async function canActor(
  actorId: string,
  required: Capability,
  target: ResourceRef, // { type: ResourceType, id: string }
  db: Db,
): Promise<ResolveResult> {
  // 0. Load actor (human or agent) WITHIN the target's org. Cross-org is an automatic deny.
  const actor = await loadActor(db, actorId); // { kind, orgId, roleId, roleKey, roleBase, roleDefaultVisibility, status }
  const targetOrgId = await orgOf(db, target);
  if (!actor || actor.orgId !== targetOrgId) return deny('cross-org-or-unknown-actor');
  if (actor.status !== 'active') return deny('actor-suspended');

  // 1. Org-privileged actions (Owner-only) short-circuit (§4.2).
  // (Caller passes an optional `privilegedAction` discriminator; omitted here for the capability path.)

  // 2. Build the containment chain root→self (≤5 hops; one CTE — §2.1).
  const chain = await ancestorChain(db, target); // [org, team?, program?, project?, task?]

  // 3. Collect every applicable, non-expired grant:
  //    subject ∈ { this actor } ∪ { actor.roleId }, resource ∈ chain,
  //    and (resource === target OR cascades === true).
  const grants = await applicableGrants(db, actor, chain); // indexed query, §7.1

  // 4. Resolve EFFECTIVE CAPABILITY by walking least→most specific (§4.4 steps 2–6).
  let effective: Capability | null = null;

  //    4a. Seed with the role org-base, if any (Members=contribute, Owner/Admin=manage, Guest=none).
  if (actor.roleBase) effective = actor.roleBase;

  //    4b. Walk the chain from root (index 0) to self. At each level, partition grants by effect.
  for (const level of chain) {
    const here = grants.filter((g) => g.resourceType === level.type && g.resourceId === level.id);
    if (here.length === 0) continue; // pass-through inherited
    const allowMax = maxCapability(here.filter((g) => g.effect === 'allow')); // actor-subject wins ties over role-subject
    const denySet = unionCapabilities(here.filter((g) => g.effect === 'deny'));
    if (allowMax) effective = raiseOrReplace(effective, allowMax); // more-specific replaces
    if (denySet) effective = subtract(effective, denySet); // most-specific deny wins
  }

  // 5. If still null, fall back to VISIBILITY for the `view` capability only (§5).
  if (effective === null) {
    if (required === 'view' && visibilityGrantsView(actor, target, db))
      return allow('visibility-public', 'view');
    return deny('no-grant-no-visibility');
  }

  // 6. A grant exists but we must still respect visibility for guests on view:
  //    (guests only ever get what a grant gives them — already handled, since guest roleBase is null
  //     and step 4 only set `effective` from an explicit grant.)

  // 7. Decision.
  return satisfies(effective, required)
    ? allow('grant-or-role', effective)
    : deny(`insufficient: have ${effective}, need ${required}`);
}
```

Key properties:

- **Deny-by-default.** No applicable grant and not visibility-public ⇒ deny.
- **Cascade with override** is implemented by the root→self replace/subtract walk (step 4b).
- **Guests are grant-only** because their `roleBase` is null _and_ their `roleDefaultVisibility='private'` short-circuits the visibility fallback.
- **Agents reuse the exact same path** — an agent is just an Actor with `roleBase=null` and a set of Actor-grants (§8).
- The function is **deterministic and side-effect-free** given DB state, so it is unit-testable and cacheable per (actor, target) within a request.

---

### 7. Enforcement

Two complementary layers. Both are mandatory; query-scoping is not a substitute for middleware and vice-versa.

#### 7.1 Server-side middleware (point checks) — `apps/api` (Hono)

A Hono middleware factory wraps any route that touches a specific resource. It calls `canActor` and 403s on deny. It also attaches the resolved decision to the context so handlers don't re-resolve.

```ts
// apps/api — authorize middleware
export const authorize = (required: Capability, locate: (c) => Promise<ResourceRef>) =>
  createMiddleware(async (c, next) => {
    const actorId = c.get('actorId'); // set by an upstream session/token middleware (auth-identity / §10)
    const target = await locate(c); // e.g. { type:'task', id: c.req.param('taskId') }
    const res = await canActor(actorId, required, target, c.get('db'));
    if (!res.allow) {
      // 404 vs 403: if the actor lacks even `view`, return 404 to avoid leaking existence (§7.5).
      const canSee =
        required === 'view' ? false : (await canActor(actorId, 'view', target, c.get('db'))).allow;
      return c.json({ error: 'forbidden' }, canSee ? 403 : 404);
    }
    c.set('authz', res);
    await next();
  });

// usage
work.patch(
  '/tasks/:taskId',
  authorize('contribute', (c) => Promise.resolve({ type: 'task', id: c.req.param('taskId') })),
  updateTaskHandler,
);
work.post(
  '/tasks/:taskId/assign',
  authorize('assign', (c) => Promise.resolve({ type: 'task', id: c.req.param('taskId') })),
  assignHandler,
);
```

- Mutations name their required capability explicitly (`contribute` for content edits, `assign` for assignee/delegate/trigger-session, `manage` for settings/grants).
- The **org-privileged actions** (§4.2) pass an additional `privilegedAction` check before the capability check.
- The same `canActor` is reused by **Server Actions** in `apps/web` for any mutation not proxied through the API, and by the **MCP tool layer** (§10). One engine, three call sites.

#### 7.2 Query-scoping (list endpoints return only permitted rows)

List/search endpoints MUST NOT fetch-then-filter in app code (leaks counts, breaks pagination). They compose a **visibility/grant predicate** into the SQL `WHERE` so the database returns only permitted rows.

The predicate for `view` on a resource type `R`, for actor `A`:

```
row is returned IFF
   (A is a member-tier role  AND  effectiveVisibility(row) = 'public'  AND  no covering DENY for A)
   OR
   (exists an ALLOW grant for A (actor-subject OR A.roleId) on row OR any cascading ancestor of row,
    that resolves to >= view, not overridden by a more-specific DENY)
```

Implementation pattern (Drizzle + Postgres), preferred form using a **precomputed grant-reach set**:

```ts
// 1. One query loads A's grant reach: the set of (resourceType,resourceId) A has an ALLOW>=view grant on
//    (actor + role subjects, non-expired), plus A's covering DENYs.
// 2. Expand cascading grants to a closure over the containment subtree using the denormalized
//    `ancestor_path` (§7.3) OR a recursive CTE — yields `visible_resource_ids` and `denied_resource_ids`.
// 3. Compose into the list query:

const rows = await db.select().from(task)
  .where(and(
    eq(task.organizationId, orgId),
    isNull(task.archivedAt),
    // grant-based OR visibility-based, minus denies:
    or(
      inArray(task.id, sql`(select resource_id from authz_visible_tasks where actor_id = ${A.id})`),
      and(
        A.roleDefaultVisibility === 'public' ? sql`true` : sql`false`,
        eq(effectiveVisibilityExpr(task), 'public'),
      ),
    ),
    notInArray(task.id, sql`(select resource_id from authz_denied_tasks where actor_id = ${A.id})`),
  ))
  .orderBy(...).limit(...).offset(...);
```

- `authz_visible_tasks` / `authz_denied_tasks` are **per-request CTEs or temp materializations**, not stored tables — built once from A's grants and reused across the request's list queries.
- For the common case (a Member with no per-resource grants) the predicate collapses to `effectiveVisibility = 'public'`, which is a cheap indexed scan.
- For Guests it collapses to `task.id IN (visible set)` — empty until granted, satisfying "guests see nothing ungranted" at the DB level.

#### 7.3 `ancestor_path` materialization (hot-path optimization)

To make both the resolver (§6 step 2) and query-scoping (§7.2 step 2) cheap, denormalize each grantable resource's containment chain as an array column updated on parent-change:

```ts
// on each grantable row, e.g. task:
ancestorPath: text('ancestor_path').array().notNull(),  // ['org:<id>','team:<id>','program:<id>','project:<id>']
```

A cascading grant on `project:X` reaches every row whose `ancestor_path @> ARRAY['project:X']` (GIN-indexable). Maintained transactionally on move (changing `project_id`/`program_id`/`team_id` rewrites the subtree's `ancestor_path`; bounded by subtree size). This avoids recursive CTEs on every list. (Implementer may start with recursive CTEs and add `ancestor_path` as an optimization once correctness is proven.)

#### 7.4 Saved Views

A Saved View stores a _filter spec_ + grouping, not a result set. On every load, results run through §7.2 query-scoping for the **requesting** actor. Therefore a shared View is automatically "permission-filtered" (mvp-plan §8.3: "a shared view always respects each person's access; a guest never sees hidden work"). No View-specific authorization beyond the per-row predicate is needed.

#### 7.5 Existence-hiding (404 vs 403)

To avoid leaking the existence of resources a Guest/Member can't see: if an actor lacks even `view`, return **404** (not 403). 403 is reserved for "you can see it but can't do _this_." This applies to both point checks (§7.1) and any direct-fetch endpoints.

---

### 8. Agents reuse this model (grants on the agent Actor)

The engineering model states plainly: **"Agent scopes are grants to the agent Actor — same system."** This spec makes that exact:

- An **Agent** is `Actor{kind:'agent', role_id: null}`. It has **no role base capability** and **no visibility-default access** — an agent therefore sees and touches **nothing** until granted, mirroring "agents start read-only" (mvp-plan §4, §8.6).
- The Agent's `grants[]` (engineering model: _"what it may read/write"_) are exactly `permission_grant` rows with `subjectKind='actor', actorId=<agent actor id>`. "Read-only" = a `view` (or `comment`) grant; "may edit this Project" = a `contribute` grant on that Project (cascading to its Tasks).
- **"Grant-on-request"** (mvp-plan §8.6): when an agent needs more access mid-Session, it requests a capability on a resource; an actor with `manage` on that resource approves, which **writes a new Actor-grant** for the agent. The agent's subsequent actions pass `canActor` normally. Time-boxed elevation uses `expiresAt`.
- **`canActor` is called with the agent's actor id** for _every_ agent-initiated read and write — there is no separate agent authorization path. The MCP tool/resource layer (§10) and the Session executor both route through it.

**Capability axis vs. approval axis — keep them orthogonal.** The agent record carries two _independent_ fields (engineering model §5):

1. **`grants[]`** — the **capability axis** (this spec): _what the agent may read/write._ Governed entirely by `permission_grant` + `canActor`.
2. **`approval_policy {suggest, act_with_approval, autonomous}`** — the **approval axis** (§9): _whether the agent's writes need a human checkpoint before applying._

A write is allowed to _apply_ only if **both** pass: the agent has the capability (`canActor` ⇒ allow) **and** the approval gate is satisfied (§9). An agent can be `autonomous` yet still blocked by lacking `contribute`; conversely it can hold `contribute` yet be forced to `suggest`.

---

### 9. The approval gate (`approval_policy` + approver routing)

The approval gate sits **after** the capability check and governs _application_ of agent writes. It is enforced in the Session executor and mirrored to the MCP tool layer.

#### 9.1 Per-write decision

```ts
/** Called for each mutation an agent attempts inside a Session. */
async function gateAgentWrite(session, agentActor, write: PendingWrite, db): Promise<GateOutcome> {
  // 1. Capability axis — MUST pass first (§8). No capability ⇒ blocked (request grant-on-request).
  const cap = await canActor(agentActor.id, requiredCapabilityFor(write), write.target, db);
  if (!cap.allow)
    return { outcome: 'needs_grant', missing: requiredCapabilityFor(write), target: write.target };

  // 2. Approval axis — based on the agent's approval_policy.
  switch (agentActor.approvalPolicy) {
    case 'autonomous':
      return { outcome: 'apply' }; // applies directly; still audited (§9.4)
    case 'suggest':
      return { outcome: 'propose_only' }; // never auto-applies; recorded as a proposal
    case 'act_with_approval':
      // Create an approval-pending Session Activity action and route to the approver(s) (§9.2).
      const approvers = await resolveApprovers(session, agentActor, write.target, db);
      return { outcome: 'awaiting_approval', approvers };
  }
}
```

- The three policy values map 1:1 to the engineering model: `suggest` = proposes only · `act_with_approval` = applies after sign-off · `autonomous` = applies directly.
- A `needs_grant` outcome surfaces the grant-on-request flow (§8); it is **not** an approval — it's a capability request, approved by a `manage`-holder.

#### 9.2 Approver routing

Default approver = **whoever assigned or delegated the task** (mvp-plan §4: _"the approver is whoever assigned or delegated the task, configurable per organization or team"_). Resolved by an ordered resolver:

```ts
async function resolveApprovers(session, agentActor, target, db): Promise<ActorId[]> {
  // (a) explicit per-Org/Team approval_routing override, if present
  const routed = await approvalRouting(db, session.organizationId, target /* may name team */);
  if (routed) return routed; // may be a specific Actor or "any member of Team X with `assign`"
  // (b) the task's assigner/delegator (the Actor who set assignee_id / delegate_id pointing at this agent)
  const initiator = await taskInitiator(db, session.taskId, agentActor.id);
  if (initiator) return [initiator];
  // (c) the agent's accountable_owner_id (engineering model)
  if (agentActor.accountableOwnerId) return [agentActor.accountableOwnerId];
  // (d) fallback: org Owners
  return await orgOwners(db, session.organizationId);
}
```

- An approver **must additionally hold `assign` on the target** (approving an agent action is an `assign`-level act — §1). The resolver filters out routed approvers who lack `assign` and falls through. This means routing can't accidentally grant approval power to someone without authority over the resource.
- `approval_routing` storage (open issue): a per-Org default + optional per-Team override; value is either a specific `actor_id` or a `team_id` (any member of that Team holding `assign`).

#### 9.3 Where approvals surface

A pending approval is a `session_activity` row of `type='action'` with approval status `proposed`. It appears:

- **in the Session view** (mvp-plan §8.6), and
- **mirrored to the approver's Hub Inbox/Today** as a `Notification{type:'approval'}` (engineering model: Notification backs the Inbox).

Approve/reject is itself an authorized action: the acting Actor must be in `resolveApprovers(...)` **and** pass `canActor(approver, 'assign', target)`. On approve → the executor applies the write (re-checking `canActor` for the _agent_ at apply time, in case grants changed) and advances the activity to `approved → applied`. On reject → `rejected`, no write.

#### 9.4 Auditing

Every agent write — autonomous or approved — records to the org-wide `audit_event` with `actor_id = agent actor` and `initiator_id = the principal` (engineering model: _"Athena, on behalf of you"_). Approval decisions are themselves audited (who approved/rejected, when). The capability axis and approval axis both leave a trail.

---

### 10. MCP & API surface integration

Every external entry point resolves a principal and routes through the _same_ `canActor` engine — there is no parallel authorization.

- **MCP server (`/mcp`, Streamable HTTP, spec 2025‑11‑25).** Org/user context derives **only** from the verified token `sub` + the token's audience binding — never client-asserted (engineering model §4: "Multi‑tenant safety"). The token `sub` maps to a `User`; combined with the requested org (from the resource URI `docket://{org}/...`) it resolves the acting **Actor** in that org. Then:
  - **Resource reads** (`docket://{org}/{type}/{id}`) → `canActor(actor, 'view', target)`; resource _lists_ apply §7.2 query-scoping so an MCP `resources/list` only returns permitted URIs.
  - **Tool calls** (mutations) → the tool's declared required capability via `canActor`, then — for agent principals — the §9 approval gate. Tool annotations (`destructiveHint` etc.) are advisory UI hints, **not** an authorization substitute.
  - **MCP scope set** (`work:read`, `work:write`, `agents:run`, `connectors:link`) is an **OAuth-token coarse gate layered _above_ `canActor`**: the token must carry the scope for the tool _and_ the resolved Actor must pass `canActor`. Scope alone never authorizes a resource; `canActor` alone is bypassed if the token lacks the scope. Both must hold.
- **Hono RPC / Server Actions.** Same `authorize` middleware (§7.1) / direct `canActor` calls. The engine lives in a shared package (e.g. `@docket/authz`) imported by `apps/api`, the Session executor, and the MCP tool layer so the rule set cannot drift between surfaces.

---

### 11. Operator (service-admin) plane — explicitly separate

`StaffUser` / `ImpersonationSession` authorization is a **distinct plane** and must never be conflated with tenant `canActor`:

- Staff roles `{support, finance, superadmin}` gate operator endpoints in `apps/admin` only.
- **"View as" impersonation** produces a _scoped, time-boxed, reason-logged_ session (`ImpersonationSession`, banner-wrapped per mvp-plan §8.9). While impersonating, tenant authorization still runs through `canActor` **as the impersonated Actor** (operators don't get a tenant super-grant); the impersonation is recorded in `OperatorAuditEvent`, not the tenant `audit_event`.
- No `StaffUser` ever appears as an `Actor` in a tenant org's grant graph.

---

### 12. Package & file layout

```
packages/
  authz/                         # the engine — pure, framework-agnostic, fully unit-tested
    src/
      capabilities.ts            # CAPABILITIES, CAPABILITY_RANK, satisfies()
      resolve.ts                 # canActor(), ancestorChain(), applicableGrants(), precedence walk (§4.4, §6)
      visibility.ts              # effectiveVisibility(), visibilityGrantsView() (§5)
      scope.ts                   # buildVisiblePredicate() for query-scoping (§7.2)
      agents.ts                  # gateAgentWrite(), resolveApprovers() (§9)
      index.ts
  db/
    schema/
      role.ts                    # role table (§4)
      permissionGrant.ts         # permission_grant table (§3)
      # (work tables carry visibility column + ancestor_path — §5, §7.3)
apps/
  api/src/middleware/authorize.ts   # Hono authorize() (§7.1)
  api/src/mcp/                       # MCP tool/resource authz wiring (§10)
```

`@docket/authz` depends on `@docket/db` (for reads) and `@docket/types` (for `Capability`/`ResourceType` enums). It is **compiled** (per the engineering compilation strategy) and imported by API, Session executor, and MCP layers.

---

### 13. Test matrix (authorization-specific; feeds the ≥80% coverage gate + Playwright personas)

Unit (`@docket/authz`):

- capability chain implication (each rank vs. each requirement)
- cascade down org→team→program→project→task; override at each level
- deny at each level subtracts correctly; most-specific-deny-wins
- actor-grant beats role-grant on tie
- guest: zero access without grant; exact-resource grant grants only that subtree; `cascades=false` pins to one row
- member: sees public by default, blocked from private, blocked from manage without grant
- owner vs admin: privileged-action gate (`org.delete` denied to admin despite `manage`)
- expired grant is inert; visibilityOverride flips access
- cross-org actor ⇒ deny; suspended actor ⇒ deny
- agent: no access without grant; grant-on-request adds capability; approval axis independent of capability axis

Integration (`apps/api`): list endpoints return only permitted rows (count-stable pagination); 404 vs 403 existence-hiding; MCP `resources/list` scoping; scope-gate + canActor both required.

E2E personas (Playwright, per engineering §6 — owner/member/guest `storageState`): `invite-guest` flow proves a guest sees nothing until granted then sees only the granted Project; `delegate-task-approve` proves the capability+approval two-axis gate end-to-end.
