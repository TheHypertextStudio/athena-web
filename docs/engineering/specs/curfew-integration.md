# Directive Feed — the generic surface a device-control app rides (area: `directive`)

> **Hosts:** `docket.app` below is a placeholder for an apex Docket has not bought yet.
> Production answers on `docket.hypertext.studio` / `docket-api.hypertext.studio` /
> `docket-admin.hypertext.studio` today — see [`domains.md` §0](../domains.md).

> **Status**: proposed — design-complete, not yet implemented. Every piece marked "reused" below is
> shipped; every piece marked "net-new" is not.
> **Last Updated**: 2026-08-02
> **Companions**: `mcp-surface.md` (the OAuth/tool/resource machinery this reuses verbatim),
> `athena-agent.md` (the session substrate a future posture engine would call into),
> `activity-feed.md` (the event substrate this deliberately does NOT plug into — see §0),
> `data-layer.md` §8 (the source-policy enforcement pattern this doc's own scope table follows)
>
> **Scope of this document.** This is the engineering design for a personal Hub, chief-of-staff
> capability: a small, versioned read surface describing "what should I be doing right now, and
> is it going badly" plus a way to close the loop on it — built so that **any** device-posture
> client can consume it, not one in particular. The concrete first (and today, only) consumer is
> a separate Hypertext Studio project, Curfew — a native macOS app that locks the user out of
> their session on a schedule. This document names Curfew freely because it is the reason the
> feature exists; **the code it specifies must not.**

---

## 0. The one hard rule this document exists to enforce

Nothing added to Docket for this feature — no route, table, column, Zod type, MCP tool name,
resource URI, scope, or enum value — may contain the string "curfew," reference Curfew's data
model (`WarningStage`, `DayRule`, extension/override budgets, reflections), or hard-code an
assumption specific to how Curfew enforces a lockout (full-screen overlay, `CGEventTap`,
privileged daemon). Everything Docket exposes is phrased as **"a device-control client asked what
it should do"** and **"a device-control client reported what it did"** — nothing more specific.

This is not a style preference. Curfew's own repo (`curfew-protocols/AGENTS.md`) independently
enforces the identical discipline in the other direction — its wire schemas are deliberately
platform-neutral (`DeviceDescriptor.platform` is an open string, not an enum; `curfew-protocols`
ships a `.NET` decoder specifically to prove the schema isn't accidentally Swift-shaped). This spec
is Docket's half of that same contract. A second consumer — a phone-side Focus Mode integration,
a browser extension that blocks sites, a `curfew`-unrelated "hard mode" productivity app — should
be able to read this section, ignore every mention of Curfew, and build against exactly the same
resource/tool pair Curfew uses, using the same OAuth client-registration flow, with zero Docket
code aware it exists.

---

## 1. Coupling boundary — what Docket/Athena actually expose

Three pieces, all already-idiomatic MCP surface (`mcp-surface.md` §3–4), two of them net-new, one
of them 100% reused with zero code changes:

| Surface                  | Kind                              | Scope                      | Status                                                 |
| ------------------------ | --------------------------------- | -------------------------- | ------------------------------------------------------ |
| `docket://hub/directive` | MCP resource (read, subscribable) | `work:read`                | **net-new**                                            |
| `acknowledge_directive`  | MCP tool (write)                  | `work:write`               | **net-new**                                            |
| `plan_day`               | MCP tool (read+write)             | `work:read` / `work:write` | **reused verbatim** (`apps/api/src/mcp/plan-tools.ts`) |

No new OAuth scope. `docs/engineering/specs/mcp-surface.md`'s existing `work:read`/`work:write`
pair already means exactly the right thing here — "see the caller's work" / "change the caller's
work" — and a fifth scope for one resource and one tool would mean a PRM-metadata edit, a consent-
screen copy change, and a new row in `TOOL_SCOPE`'s exhaustiveness test for a security boundary
that does not actually shrink: a client that can render "Finish Q3 deck" on a lock screen already
needed `work:read`-equivalent visibility to do that. This directly satisfies the instruction to
reuse the existing auth pattern rather than invent a parallel one — Curfew's OAuth client requests
`work:read work:write offline_access` and nothing else. It never requests `agents:run` (it does not
run agent sessions) or `connectors:link` (it does not link Docket to third-party services).

**Why Curfew is a consumer, not a special case.** `docket://hub/directive` is a _static Hub
resource_, resolved purely from the verified token's `sub` (`mcp-surface.md` §4.2) — exactly like
the already-shipped `docket://hub/today`/`hub/inbox`/`hub/portfolio`. `authorizeResourceUri`'s Hub
branch (`apps/api/src/mcp/resources.ts:192`) needs zero new special-casing: it already treats every
Hub URI as "gate on scope, resolve against the caller's own Hub, done." `acknowledge_directive`
needs zero new special-casing either — it is registered exactly like `plan_day`, gated by the same
`TOOL_SCOPE` map whose completeness is already asserted by `tests/mcp/mcp-scope.test.ts`. Any MCP
client that completes the same CIMD/DCR + consent flow documented in `mcp-surface.md` §2 gets the
same tools. Docket's server code has no `if (clientId === curfew)` branch anywhere, and this spec
requires that it never grow one.

**What Docket explicitly refuses to know about, by design:**

- **When the workday starts or ends.** That's a schedule — Curfew's `DayRule`/`SchedulePolicyEngine`
  domain (curfew research §1). The directive carries _content_ ("this is today's plan, this is how
  it's going"), never a clock boundary. A device-control client decides when to gate based on its
  own schedule; Docket never tells it to.
- **How enforcement happens.** Docket returns a `posture` (an abstract severity) and, optionally, a
  `recommendedAction` naming one task to narrow focus toward. It never says "lock the screen,"
  "quit this app," or "run this command." Curfew's own remote-command schema
  (`curfew-protocols/schemas/remote-command.json`) already enforces an identical ceiling on its
  side — "only `lock_device`; no remote unlock, override, schedule weakening, script, or executable
  command" — so this boundary isn't just Docket's preference, it's the only shape Curfew would
  accept anyway.
- **Anything about the user's private reflection.** Curfew's `ReflectionStore` is explicitly
  "never written by agents" per `curfew-flow.md`; this design does not ask Curfew to change that.
  The _structured_ outcome of a day (which tasks got done, tomorrow's draft) flows back to Docket
  through the ordinary `plan_day` tool; the _prose_ stays wherever Curfew already keeps it.

---

## 2. The daily flow, as concrete system interactions

```
 wake   Curfew SUNRISE ──resources/read──▶ docket://hub/directive
                          ◀── plan (today), posture, reason ──
                        Curfew renders the agenda, then (only then) releases the device.
                        Optional: a deep link into the existing Athena chat thread
                        (athena-agent.md §1, already shipped) for "Athena helps me review"
                        as a real conversation — no new capability needed for that part.

 all day  (opt-in, HubPreferences.directive.enabled)
          every 5 min   sweepDirectivePosture (cron) recomputes posture from daily_plan_item
                         vs. wall clock (§4). Unchanged posture: no-op. Changed posture:
                         persist + publish notifications/resources/updated for
                         docket://hub/directive (mcp-notifications.md's existing LISTEN/NOTIFY
                         fan-out — no new transport).

          Curfew          v1: resources/read on a timer (poll).
                           v2: resources/subscribe, held open (push) — see §3.5 for why v1
                               ships first.
                         On posture escalation, Curfew's own SchedulePolicyEngine decides what
                         to do with it (narrow the visible window, pull DUSK warnings earlier,
                         etc.) — Docket never issues that instruction, only the posture + reason.

 evening  Curfew SUNDOWN ──resources/read──▶ docket://hub/directive (final state of the day)
                         user reconciles what actually got done
                        Curfew ──tools/call plan_day {orgId, date: today, edits}──▶ Docket
                          (complete / reopen / remove on today's items, per org represented)
                         user drafts tomorrow (with or without Athena's help)
                        Curfew ──tools/call plan_day {orgId, date: tomorrow, edits}──▶ Docket
                          (add / timebox for tomorrow, per org)
                        Curfew ──tools/call acknowledge_directive {directiveId, ...}──▶ Docket
                          (closes the loop: did enforcement happen, did the user follow it)
                         user's free-text reflection stays in Curfew's local ReflectionStore —
                         never sent to Docket.
```

Two things worth calling out explicitly because the goal doc asks for them directly:

**"What does Athena hand back: a new schedule, a hard block instruction, or both?"** Both, but
both stay inside Docket's own vocabulary, never Curfew's. Athena can rewrite the _plan_ (drop,
reorder, re-timebox items — this already works today via `plan_day`, called by Athena's own agent
loop the same way a human MCP client calls it) and separately reports a _posture_ + _reason_ +, at
most, one `recommendedAction.taskId` to narrow focus toward. There is no third option where Docket
sends an imperative enforcement command — that vocabulary does not exist on either side of this
integration by design (§0, and Curfew's own `remote-command.json` ceiling).

**"How does Curfew learn Athena wants to intervene, and what's the realistic latency?"** See §3.5
for the full answer; the short version is **poll every 5 minutes in v1** (matches the posture
sweep's own cadence — polling faster only re-reads a value that hasn't changed), upgrading to a
push (`resources/subscribe`) once Curfew is holding a persistent connection to Docket for other
reasons anyway. Worst case in either version: ~5 minutes between "the plan says you're behind" and
"the device-control client knows it."

---

## 3. API surface

### 3.1 Auth — 100% reused, zero new plumbing

Curfew registers as any third-party MCP client does (`mcp-surface.md` §2.4): CIMD preferred, DCR
fallback. It requests `work:read work:write offline_access` at consent. Tokens are the same 15-
minute-access/30-day-refresh JWTs every other client gets; `offline_access` matters here more than
almost anywhere else in the system, because this client runs unattended, on a timer, with no human
present to re-consent. Every existing invariant in `mcp-surface.md` §2.5 (audience binding, issuer
check, no token passthrough, two-layer scope+grant authorization) applies unmodified. There is no
API key, no webhook secret, no bespoke device-pairing flow — the OAuth 2.1 RS/AS pair already
running at `/mcp` is the entire auth surface.

### 3.2 Resource: `docket://hub/directive`

Registered beside the other static Hub resources (`apps/api/src/mcp/resource-statics.ts`),
resolved purely from the caller's `sub` — no `orgId` argument, exactly like `docket://hub/today`.
Always means "today, in the Hub's configured timezone" (`HubPreferences.timezone`); there is no
date parameter, because a device-control client asking "what should I be doing right now" never
means a day other than today.

```ts
// deleted legacy module directive — net-new
export const DirectivePosture = z
  .enum(['on_track', 'attention_needed', 'intervention_recommended'])
  .describe(
    "Athena's current read on the day, most to least on schedule. Deliberately generic — " +
      'a device-control client maps this onto whatever enforcement it owns.',
  );

export const DirectivePlanItemOut = z
  .object({
    taskId: TaskId,
    organizationId: OrganizationId,
    title: z.string(),
    status: z
      .enum(['planned', 'done'])
      .describe(
        "Mirrors `daily_plan_item.status` exactly. There is no `deferred` value: Docket's daily " +
          'plan has no such state — a dropped item is a `plan_day` `remove` edit (the row is ' +
          'deleted), never relabeled.',
      ),
    priority: Priority.optional(),
    startsAt: z.string().optional().describe('`daily_plan_item.timeboxStartsAt`, when timeboxed.'),
    endsAt: z.string().optional().describe('`daily_plan_item.timeboxEndsAt`, when timeboxed.'),
    url: z.string().optional().describe('Deep link into the Docket web app for this task.'),
  })
  .meta({ id: 'DirectivePlanItemOut' });

export const DirectiveRecommendedAction = z
  .object({
    kind: z.literal('narrow_focus'),
    taskId: TaskId,
    proposalId: z.string(),
  })
  .meta({ id: 'DirectiveRecommendedAction' })
  .describe('The one thing Athena thinks deserves the client’s full attention right now, if any.');

export const DirectiveOut = z
  .object({
    schemaVersion: z.literal('directive/1'),
    directiveId: z
      .string()
      .describe('This computed snapshot’s id; echo it to acknowledge_directive.'),
    date: DateString,
    timezone: z.string(),
    generatedAt: z.string(),
    plan: z.array(DirectivePlanItemOut),
    attention: z.object({
      blocked: z.number().int(),
      dueToday: z.number().int(),
      approvalsPending: z.number().int(),
    }),
    posture: DirectivePosture,
    reason: z.string().max(280).describe('Plain-language, safe to show the user verbatim.'),
    recommendedAction: DirectiveRecommendedAction.nullable(),
  })
  .meta({ id: 'DirectiveOut', description: 'Generic daily-directive projection.' });
```

`attention` is not a new computation — it is `buildHubTodayPayload`'s (`apps/api/src/routes/hub-today.ts`,
already backing both the Hub Today screen and the `brief` MCP tool) existing `needsAttention` trio,
turned into counts (`needsAttention.blocked.length`, `.dueToday.length`, `.approvals.length` —
`HubNeedsAttention`'s actual field is `approvals`, an array; it's renamed `approvalsPending` here
only because a bare `approvals: number` reads oddly next to `plan`'s per-item detail, not because
the underlying data differs).

`plan` is **not** a reshape of `buildHubTodayPayload`'s `plan` array, and reusing it directly would
be wrong: that array unions in tasks merely _due_ today that were never pulled into the daily plan,
and its `HubTaskItem.state` is an org-defined, free-form workflow string (`todo`, `in review`,
whatever that org configured) — not the closed `planned`/`done` this schema's `status` field above
promises, and there is no path from `state` to a `deferred` value because none exists anywhere in
the data model (a prior draft of this schema invented one; fixed above). `DirectivePlanItemOut` is
built from a direct `daily_plan_item` ⋈ `task` query instead — the same query §4's posture sweep
already runs — mapping `daily_plan_item.status`/`timeboxStartsAt`/`timeboxEndsAt` straight onto the
DTO with no reinterpretation. This is a deliberate, small divergence from `buildHubTodayPayload`,
not an oversight: a device-control client asking "what's my day" needs exactly the committed,
timeboxed plan posture is computed over, not the Hub Today screen's broader "everything on my radar
today" list. The two genuinely net-new fields, `posture` and `recommendedAction`, are described in
§4.

**Example `resources/read`:**

```jsonc
// request
{ "jsonrpc": "2.0", "id": 12, "method": "resources/read",
  "params": { "uri": "docket://hub/directive" } }

// response
{
  "jsonrpc": "2.0", "id": 12,
  "result": {
    "contents": [{
      "uri": "docket://hub/directive",
      "mimeType": "application/json",
      "text": "{\"schemaVersion\":\"directive/1\",\"directiveId\":\"dir_01J...\",\"date\":\"2026-08-02\",\"timezone\":\"America/Chicago\",\"generatedAt\":\"2026-08-02T13:05:00Z\",\"plan\":[{\"taskId\":\"tsk_01J...\",\"organizationId\":\"org_01J...\",\"title\":\"Finish Q3 deck\",\"status\":\"planned\",\"priority\":\"high\",\"startsAt\":\"2026-08-02T13:00:00Z\",\"endsAt\":\"2026-08-02T14:30:00Z\",\"url\":\"https://app.docket.app/org_01J.../tasks/tsk_01J...\"}],\"attention\":{\"blocked\":1,\"dueToday\":2,\"approvalsPending\":0},\"posture\":\"attention_needed\",\"reason\":\"The 1:00 deck work is 20 minutes overrun and nothing else today has slack.\",\"recommendedAction\":{\"kind\":\"narrow_focus\",\"taskId\":\"tsk_01J...\",\"proposalId\":\"prop_01J...\"}}"
    }]
  }
}
```

**Subscription:** advertised via the resource's normal `resources/subscribe` path
(`mcp-notifications.md`, already shipped transport — `resources: { subscribe: true }` is already
advertised server-wide, `apps/api/src/mcp/server.ts:61`). `notifications/resources/updated { uri:
"docket://hub/directive" }` fires on two triggers: (a) any `plan_day` edit for today; (b) the
posture sweep (§4) computing a **different** posture than last time. Same-value recomputes are
silent, so a healthy day produces no notification traffic.

Correction against the codebase as it stands: no publish hook notifies `docket://hub/today` (or any
other Hub-aggregate resource) today. The existing write-through notifier
(`apps/api/src/search/write-through.ts`) is keyed to single-entity URIs
(`docket://{orgId}/{type}/{entityId}`, built by `entityUri`) — a different shape than a caller-scoped
Hub aggregate has, and it is never invoked from `plan_day`'s edit path at all. This feature adds the
**first** Hub-aggregate publish call: `plan_day`'s edit path calls the already-shipped, lower-level
`notifyResourceUpdated('docket://hub/directive')` (`apps/api/src/mcp/notify.ts`) directly — the same
primitive `write-through.ts` calls, just not routed through its per-entity `announce()` wrapper.
`docket://hub/today` has the identical latent gap; wiring it in the same change is a one-line
freebie, not a dependency of this feature.

### 3.3 Tool: `acknowledge_directive` (net-new)

```ts
// deleted legacy module directive
export const AcknowledgeDirectiveInput = z
  .object({
    directiveId: z.string().describe('The directiveId being acknowledged.'),
    appliedPosture: DirectivePosture.describe('The posture the client actually acted on.'),
    enforced: z.boolean().describe('Whether the client changed device state in response.'),
    note: z.string().max(500).optional(),
  })
  .meta({ id: 'AcknowledgeDirectiveInput' });

export const AcknowledgeDirectiveOutput = z
  .object({ acknowledged: z.literal(true), acknowledgedAt: z.string() })
  .meta({ id: 'AcknowledgeDirectiveOutput' });
```

| readOnly | destructive | idempotent | openWorld | Scope        |
| :------: | :---------: | :--------: | :-------: | ------------ |
|    F     |      F      |   **T**    |     F     | `work:write` |

Idempotent by upsert on `(hub_id, directive_id)` — a retried call after a dropped connection
overwrites the same row rather than appending a duplicate, matching the create-tool idempotency-key
convention already established in `mcp-surface.md` §3.1, without needing a separate key param
because `directiveId` already is the natural dedupe key. Resolution is Hub-only (`callerHub`,
already implemented and reused verbatim from `plan-tools.ts`) — no `orgId`, no per-org grant
cascade, same shape as `brief`/`plan_day`'s Hub resolution.

Persists to a small net-new audit table so Athena (and a human, in Settings) can see whether a
device-control client is actually acting on what it's told:

```ts
// packages/db/src/schema — net-new
export const directivePosture = pgEnum('directive_posture', [
  'on_track',
  'attention_needed',
  'intervention_recommended',
]);

export const directiveAcknowledgment = pgTable(
  'directive_acknowledgment',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    directiveId: text('directive_id').notNull(),
    oauthClientId: text('oauth_client_id').notNull(), // whichever registered MCP client sent it
    appliedPosture: directivePosture('applied_posture').notNull(),
    enforced: boolean('enforced').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('directive_ack_hub_directive_uq').on(t.hubId, t.directiveId)],
);
```

`oauthClientId` is exactly the generic identifier Docket already tracks for any registered MCP
client (`oauth_application`, from the existing Better Auth OIDC provider tables) — it is how the
audit trail distinguishes consumers without Docket's schema ever naming one.

### 3.4 Reused tool: `plan_day`

No changes. `apps/api/src/mcp/plan-tools.ts` already takes `{ orgId, date, edits[] }` where `date`
is any `YYYY-MM-DD`, not just today, and edits are `add | remove | complete | reopen | timebox`.
End-of-day reconciliation is `edits` against today's `date`; tomorrow's draft is `edits` against
tomorrow's `date`, in a second call. This is the single strongest argument that the coupling
boundary in §1 is real, not aspirational: the exact tool the Hub Today screen and Athena's own
agent loop already call is, unmodified, the entire write path a device-control client needs for
the hardest part of the goal doc ("reconcile unfinished work, and intentionally prepare the next
day's agenda"). The one rough edge: `plan_day` is per-`orgId`, while the directive is cross-org, so
a user with tasks in two orgs on one day means two `plan_day` calls at review time — acceptable,
and consistent with how every other cross-org Docket surface (the Hub itself) already delegates
writes to per-org tools.

### 3.5 Delivery: why polling ships first

Either transport requires Curfew to gain something it does not have today: an outbound network
call to Docket at all. `curfew-mcp` (curfew research §4A) is a **local** MCP server — it accepts
connections, it does not make them. Whether Curfew polls or subscribes, this is net-new Curfew-side
work of the same rough size (§7), so the choice is about which is simpler to operate, not which is
cheaper to build:

|                  | Poll (`resources/read` on a timer)                                        | Push (`resources/subscribe`, held open)                                                            |
| ---------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Connection model | Stateless HTTP call every N minutes                                       | One persistent Streamable-HTTP GET-SSE stream per `mcp-surface.md` §1.1                            |
| Latency          | Bounded by poll interval                                                  | Bounded by the posture sweep's own cadence (§4) plus the existing sub-second LISTEN/NOTIFY fan-out |
| Resilience       | Trivially resumes after sleep/network loss (Mac laptops sleep constantly) | Needs its own reconnect/backoff logic on the Curfew side                                           |
| Server cost      | One request per interval per device                                       | One held connection per device, indefinitely                                                       |

Recommendation: **v1 polls, every 5 minutes**, matching the posture sweep's own cadence exactly —
polling faster only re-reads a value that has not changed since the last sweep ran. **v2 upgrades
to `resources/subscribe`** once Curfew is holding a persistent connection to Docket for an
unrelated reason anyway — which is likely once `curfew-sync`'s own coordinator relationship exists,
at which point riding the same connection for directive pushes costs nothing additional. Worst-case
end-to-end latency in either version is the same: **~5 minutes** from "the plan says the user is
behind" to "the device-control client knows it," which is the honest number to give the user rather
than implying anything closer to real-time.

### 3.6 Versioning

This repo's own history is the precedent (`mcp-surface.md` §3.3): when a tool surface changed
shape, the old tool was deleted and a new one took its name — there is no in-place version-bumping
convention for MCP tools/resources here, and this feature does not invent one:

- `docket://hub/directive` and `acknowledge_directive` are **additive-only** for their lifetime —
  new optional fields may appear; no field is ever renamed, retyped, or reinterpreted.
- `schemaVersion: "directive/1"` ships as a literal in every payload as a defensive assertion for
  clients that don't do MCP capability negotiation carefully — a hard break is visible even to a
  client that only checks this one field.
- A genuine breaking change ships as a new name — `docket://hub/directive-v2` or
  `acknowledge_directive_v2` — coexisting with the original during a deprecation window, announced
  the same way every other MCP surface change here is: `notifications/resources/list_changed` /
  `notifications/tools/list_changed` plus a `docs/WORKLOG.md` entry. The MCP
  `MCP-Protocol-Version` header (`mcp-surface.md` §1.1) is a separate, already-solved, lower layer
  this feature does not touch.

---

## 4. Posture computation — the part that doesn't exist yet anywhere

This is the actual net-new judgment behind "dynamically reorganizes work and proactively stops me."
The research is blunt about the current state: no code path anywhere decides "is this person
behind" (`createSessionFromObservation` exists but has no live caller; `sweepProactiveSessions` is
referenced in a docstring and does not exist; `health` is a manually-posted human judgment, never
computed from deadlines). This spec does not pretend otherwise — it specifies the smallest
computation that is honestly buildable now, with an explicit, separate upgrade path.

**v1 — a deterministic, cron-computed heuristic over data that already exists.** No LLM call, no
new agent session, nothing probabilistic. `computeDirectivePosture(hubId, date)` reads that day's
`daily_plan_item` rows and compares timeboxes to wall-clock `now`:

- An item is **overrun** when `status = 'planned'` and `timeboxEndsAt < now`.
- 0 overrun items → `on_track`.
- Exactly 1 overrun, or the current item is within 15 minutes of its `timeboxEndsAt` and not yet
  `done` → `attention_needed`.
- ≥2 overrun items, or the _current_ timeboxed item is overrun by more than 30 minutes →
  `intervention_recommended`, with `recommendedAction = { kind: 'narrow_focus', taskId: <the
longest-overrun item>, proposalId }`.

`reason` is generated from the same inputs by a plain string template (no model call) — e.g. "The
1:00 deck work is 20 minutes overrun and nothing else today has slack." This is intentionally
unambitious: it is a schedule-adherence check, not judgment about whether the work itself matters,
and it says so nowhere near the framing of "AI decided you're failing."

`sweepDirectivePosture` (`apps/api/src/routes/directive-sweep.ts`, mounted at
`/internal/cron/directive-posture`) runs every 5 minutes — the same floor `sweepAthenaAssignmentTriggers`
already established for "how often is it reasonable to re-evaluate a person's day"
(`apps/api/src/agent/assignments.ts`) — over every Hub with `HubPreferences.directive.enabled: true`
(a new opt-in field, added to `domains/planning/src/contracts/hub-preferences.ts` beside the existing
`proactive`/`digest` blocks, same shape, same "explicit opt-in, no hidden default" convention). It
persists the new posture only when it changed and publishes the resource-updated notification (§3.2)
only in that case.

**v2 — Athena's actual judgment, deferred.** The honest long-term version of "Athena decides
dynamically" replaces the heuristic with a real reasoning turn: an Athena session (the same
substrate `athena-agent.md` already documents — an `AgentTurnRuntime` turn over the day's plan,
today's `event` activity, and the user's own `AthenaPreferences.instructions`) producing the
posture and reason instead of a template. This is explicitly **not v1** — it requires either
building the missing `sweepProactiveSessions` (flagged as dead code with no caller today) or an
equivalent scheduled-turn mechanism, and it introduces LLM cost and latency into a 5-minute-cadence
sweep, which needs its own design pass on batching/backoff. v1's heuristic is the thing that makes
`posture`/`recommendedAction` real data instead of a placeholder while that work is pending — it is
not a stub in the AGENTS.md sense (it is a complete, correct implementation of a smaller, explicitly
scoped problem), and swapping its internals for v2 changes nothing about the API surface in §3.

---

## 4A. The outbound half: asking for more evening

Everything above is Docket **publishing** and a device-control client **reading**. This section is
the one place the arrow reverses, and it is scoped as narrowly as it is precisely because of that.

**The problem.** Athena owns the day plan and can see when the work still on it no longer fits
before the working window closes. She does not own the boundary. Without a way to ask, the only
two outcomes are a deadline that silently slips or a person who weakens their own schedule by
hand — and the second is exactly the failure a device-control client exists to prevent.

**Where the signal comes from — derived, not invented.** No function in this repo expressed
"a deadline will not fit in the remaining working window" before this step. `computeDirectivePosture`
(`apps/api/src/services/scheduling/day-loop.ts`) reports `driftMinutes`, which is lateness measured
backwards from a block that already overran and says nothing about whether what remains still fits.
The concept that _does_ exist is `ReorganizeResult.displaced` — the blocks `reorganizeDay` could not
re-place into the availability the day genuinely has left. That set is the overflow, so
`assessEveningShortfall` reads it rather than modelling the same question a second way, and calls
`reorganizeDay` purely: the moves are discarded, nothing is written, and assessing a shortfall never
rearranges a day behind the person's back.

**The port.** One interface, two methods — `submitExtensionRequest` and `pollExtensionRequest`
(`apps/api/src/services/boundary/port.ts`). Two, because a boundary client's write surface is
consent-gated and _queued_: submitting returns an identifier and the person's answer arrives later,
out of band. Nothing in this design returns a grant, because nothing on the other side can. A real
MCP client (`mcp-adapter.ts`) and a test double satisfy the same contract. No port is installed by
default, and a deployment without one does nothing at all — that is a configuration state, not an
unfinished path.

**Four policies, all enforced in code and covered by tests:**

| Policy                          | Where it lives                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bounded at two hours            | `MAX_EVENING_EXTENSION_MINUTES`, clamped in the pure assessment and re-asserted at the submit boundary                             |
| Wake time never modified        | No column, no method, and no code path on this route writes an availability window, a wake time, or `agendaAcknowledgedAt`         |
| Athena asks, the client decides | Every terminal answer — including no answer — leaves the plan untouched; there is no "apply the extension" branch                  |
| A refusal is never a retry      | `(hub_id, date, deadline_key)` is unique; any resolved state is final per deadline, and `budget_exhausted` seals the whole Hub-day |

**Where it runs.** On the **existing** posture sweep (§4), inside the same per-Hub loop, not on a
second schedule. It is deliberately outside that sweep's change-only guard: a day whose posture has
not moved can still have a request waiting on an answer, and skipping the poll on a quiet tick is
how a pending request would go unresolved all evening.

**Two honest deviations from what a first reading of this document would suggest:**

1. **§6.1 says Docket builds no egress primitive.** This is egress — narrowly. It is not a generic
   webhook system; it is one port with two methods, reachable only by a deployment that installs an
   adapter, and it carries a request rather than an instruction. The §0 ceiling on _enforcement
   vocabulary_ is untouched: Docket still never says "lock", "block", or an app name.
2. **The bound cannot be expressed on the wire.** The real submit tool's argument schema is
   `{ reason }` and nothing else — there is no duration argument anywhere in
   `curfew-protocols/schemas/mcp-tools.json`, and how much an extension is worth is the boundary
   client's own setting. So the two-hour bound is Docket's _self-imposed ceiling on what it will
   ask for_, recorded Docket-side and folded into the human-readable reason. Claiming the other
   side honours a number it was never sent would be inventing a wire field.

Per §0 no product name appears in any of this code. Both tool names arrive as configuration, which
is also the only way a second, unrelated boundary client could use the same adapter unchanged.

---

## 5. What's realistic given Curfew's actual blocking mechanism

Read against the curfew research, several parts of "literally makes it impossible for me to do
anything else" are honest gaps, not near-misses. This table separates what Docket-side work closes
(nothing left to do) from what depends on Curfew evolving beyond what's shipped today.

| Piece of the vision                                                                                      | Docket/Athena readiness                                                                                                                     | Curfew readiness                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Curfew opens Docket to inform me of the day's agenda"                                                   | Ready once §3.2/§4 ship — one `resources/read` call returns the whole payload                                                               | Not ready — Curfew has no Docket-aware UI today; its SUNRISE step (`curfew-flow.md`) is a local morning-intent prompt with no external data source                                                                                                                                                                                                                                                                                                                                         | Curfew-side UI work only; no further Docket API needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| "Curfew stops me from doing anything else until going through Curfew"                                    | N/A — this is Curfew's existing, already-shipped SUNRISE device-open gate, independent of Docket                                            | **Already shipped**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | None — just needs the gate to fetch+render the directive before releasing, per the flow in §2                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| "Athena checks in repeatedly... dynamically reorganizes work"                                            | Ready for the "reorganize" half (`plan_day`, already exists); the "checks in" half needs §4's sweep (net-new, but scoped and buildable)     | Not ready — nothing in Curfew today receives an externally-computed signal; `CurfewEnforcementEngine` is driven entirely by its own local `WarningStage`/`DayRule` state                                                                                                                                                                                                                                                                                                                   | Curfew-side: teach the enforcement engine to accept an external `posture` and fold it into a _local_ schedule decision (e.g. moving today's `DayRule` end time earlier, or pulling a DUSK warning forward) — Docket still never issues an enforcement command (§0), it only ever narrows                                                                                                                                                                                                                                               |
| "...proactively stops me from doing other work"                                                          | Ready to _recommend_ (`posture: intervention_recommended`)                                                                                  | Partially ready to _execute_ — Curfew's real blocking mechanism is a full-screen overlay + `CGEventTap` shortcut interception (`OverlayCoordinator.swift`, `LockoutKeyInterceptor.swift`), triggered today only by its own schedule reaching zero, never by an external signal                                                                                                                                                                                                             | Same gap as above: accepting an external trigger for an _existing_ mechanism is buildable; it is not currently wired to anything outside Curfew's own clock                                                                                                                                                                                                                                                                                                                                                                            |
| "...impossible for me to do anything else" (literally)                                                   | N/A                                                                                                                                         | **Explicitly, self-acknowledged not true even for Curfew's own scheduled lockout.** Curfew's own code comment: "a determined user with root access can still bypass it" — `kill -9`/Activity Monitor defeats the `CGEventTap` layer; only the privileged daemon's _shutdown timer_ is root-owned and authenticated, and that's a last-resort power-off, not app-level control. There is no per-application blocking anywhere in Curfew's codebase — it locks the whole session or nothing. | This is a **Curfew product ceiling**, not an API gap Docket can close. Getting closer to "literally impossible" requires Curfew to grow toward MDM/Screen-Time-style per-app enforcement or a kernel-level mechanism — and Curfew's own `curfew-sync.md` explicitly and repeatedly disclaims MDM/parent-style control as a non-goal. Worth surfacing to the user directly: the "draconian" framing in the goal doc is achievable as a _strong, repeated nudge with real friction_, not as a literal lock, on the current architecture. |
| "Curfew blocks me out of all apps and prevents further device use until I complete [the SUNDOWN review]" | N/A — this is Curfew's own SUNDOWN device-lockout gate, independent of Docket, symmetric to the "Curfew stops me..." SUNRISE-gate row above | Already shipped as a lockout mechanism (Curfew's SUNDOWN step exists and runs today — see the next row)                                                                                                                                                                                                                                                                                                                                                                                    | None on the gate itself — same shape as the SUNRISE row: it just needs something Docket-sourced to show before releasing the user, which the next row supplies                                                                                                                                                                                                                                                                                                                                                                         |
| End-of-day structured review, reconcile, prepare tomorrow                                                | Ready (`plan_day`, reused; `acknowledge_directive`, net-new and small)                                                                      | Not ready — Curfew's SUNDOWN step today only captures a local reflection (`ReflectionStore`), with no Docket call                                                                                                                                                                                                                                                                                                                                                                          | Curfew-side: a new review screen that reads §3.2's payload and calls `plan_day` twice (today + tomorrow) and `acknowledge_directive` once, per §2                                                                                                                                                                                                                                                                                                                                                                                      |
| Remote (phone-initiated, cross-device) enforcement                                                       | N/A                                                                                                                                         | Not ready — `curfew-sync` is an unbuilt skeleton (§3 of the research); even once built, its remote-command vocabulary is `lock_device` only, nothing partial                                                                                                                                                                                                                                                                                                                               | Entirely a Curfew-side and `curfew-sync`-side build; irrelevant to this integration until that backend exists, at which point it's still whole-session lock, never app-selective                                                                                                                                                                                                                                                                                                                                                       |

---

## 6. Non-goals / deferred scope

Explicitly out of scope for a first working version — anything here can be picked up later without
reshaping what ships:

1. **No outbound webhook/push system.** Docket has no generic egress primitive today (confirmed by
   the research — every notification channel terminates at a Docket-controlled destination). This
   feature does not build one; it rides the already-shipped MCP `resources/subscribe` transport
   instead. A generic webhook system, if ever needed by a consumer that can't hold an MCP
   connection, is a separate, larger investment and not a blocker here.
2. **No LLM-driven posture judgment in v1.** §4's heuristic ships first; the Athena-reasoning
   upgrade is explicitly deferred and does not block anything in §3.
3. **No cross-device directive sync.** This design assumes one always-on consumer process per user
   (Curfew on one Mac). Multi-device consistency is `curfew-sync`'s own concern once it exists, not
   something Docket mediates.
4. **No enforcement vocabulary beyond `posture` + one `recommendedAction.taskId`.** Docket will
   never grow a "quit app X" / "block URL Y" / "run script Z" instruction. This is a permanent
   design line (§0), not a v1-only limitation.
5. **No org-level or admin device-control policy.** Hub-scoped, personal-only, matching how the
   rest of the Hub surface (today/inbox/portfolio) already works. A team-wide "focus mode" is a
   different, unrelated feature.
6. **No ingestion of Curfew's reflection text into Docket.** Stays Curfew-local, by Curfew's own
   design (`ReflectionStore` is "never written by agents"); this integration does not ask for an
   exception.
7. **No new REST `/v1` endpoints.** MCP-only, because MCP is the only surface in this codebase that
   accepts a Bearer token at all — a REST endpoint here would be new authentication surface, not a
   reuse of one (confirmed by the research: `/v1` resolves auth only via cookie session).
8. **No guaranteed real-time delivery in v1.** Polling at a 5-minute floor is the shipped default;
   §3.5's push upgrade is explicitly a v2, not a commitment made by this design.

---

## 7. Net-new work checklist

### Docket/Athena side (this repo)

- [ ] `deleted legacy module directive` — `DirectivePosture`, `DirectivePlanItemOut`,
      `DirectiveRecommendedAction`, `DirectiveOut`, `AcknowledgeDirectiveInput/Output` (§3.2, §3.3)
- [ ] `packages/db` — `directive_posture` enum + `directive_acknowledgment` table + migration
      (§3.3)
- [ ] `HubPreferences.directive.enabled` opt-in field, `domains/planning/src/contracts/hub-preferences.ts`,
      beside `proactive`/`digest` (§4)
- [ ] `docket://hub/directive` static resource, `apps/api/src/mcp/resource-statics.ts`, gated
      `work:read`, subscribable (§3.2)
- [ ] Call `notifyResourceUpdated('docket://hub/directive')` from `plan_day`'s edit path — no
      Hub-aggregate publish hook exists for any Hub resource today (§3.2); optionally also call it
      for `docket://hub/today`, which has the identical latent gap, while touching this code path
- [ ] `acknowledge_directive` tool, `apps/api/src/mcp/directive-tools.ts`, gated `work:write`,
      `openWorldHint: false`, upsert-idempotent (§3.3)
- [ ] `computeDirectivePosture(hubId, date)` — pure function, no I/O beyond the read (§4)
- [ ] `sweepDirectivePosture` cron at `/internal/cron/directive-posture`, 5-minute cadence,
      opt-in-only, notification-on-change-only (§4)
- [ ] `TOOL_SCOPE` entry + the existing `tests/mcp/mcp-scope.test.ts` exhaustiveness check picks
      up `acknowledge_directive` automatically
- [ ] Resource/tool e2e coverage mirroring `apps/web/e2e/mcp-connect.spec.ts` /
      `mcp-session.spec.ts`'s existing pattern (discover → register → consent → read → subscribe →
      call)

### Curfew side (a different repo; flagged here for the full picture, not this repo's obligation)

- [ ] Register a Docket OAuth client (CIMD or DCR) and hold a token with `offline_access` — net-new,
      since `curfew-mcp` today only accepts connections, never makes one (§3.5)
- [ ] SUNRISE-phase UI that reads `docket://hub/directive` and renders it before releasing the
      device gate (§2)
- [ ] Teach `CurfewEnforcementEngine`/`SchedulePolicyEngine` to accept an externally-supplied
      `posture` and translate it into a local schedule decision — the piece that turns a Docket
      _recommendation_ into an actual Curfew _enforcement_ action (§5)
- [ ] Choose poll (v1) or subscribe (v2) per §3.5 and implement it
- [ ] SUNDOWN-phase review UI that reads the final directive, calls `plan_day` twice (today,
      tomorrow), and calls `acknowledge_directive` once (§2, §3.3)
- [ ] A product decision, not an engineering one: whether/how to close the "literally impossible"
      gap in §5 — per-app blocking or kernel-level enforcement — is explicitly out of this
      integration's scope and contradicts `curfew-sync.md`'s current non-goals, so it needs its own
      separate discussion before any code follows it
