# Athena → Docket Feature Audit

> **Created**: 2026-06-28
> **Purpose**: Inventory functionality that existed in the old **Athena** app but is absent or
> only partially present in the **Docket** rewrite, so we can decide what to backfill before
> launch and what to queue as post-launch porting.

## Background

This repo was rewritten from **Athena** (a personal calendar/productivity app, `athena-service`
v0.0.0) into **Docket** (a team/project-management app, `@docket/root` v1.3.0). The two lines
diverged from a common ancestor (`2a208ec`, Jan 4 2026): Athena stopped at `c0d96f4` (Jan 15),
Docket continued to `56626f9` (Jun 16). `main` now tracks Docket.

The old Athena code is preserved and recoverable:

| Ref | What it holds |
|---|---|
| `backup/pre-reset-c0d96f4` | Athena's last committed tip (all 155 commits) |
| `backup/athena-worktree-snapshot` | Above **plus** the uncommitted route-restructuring WIP |
| `stash@{0}` | WIP: Athena API route restructuring |
| `stash@{1..4}` | lint-staged automatic backups |

Read any Athena file without switching branches, e.g.
`git show backup/pre-reset-c0d96f4:apps/api/src/routes/dav.ts`.

## Launch priorities (from the user)

1. **Task management** — exists in Docket (`tasks.ts`, `task-dependency-routes.ts`, `task-helpers.ts`).
2. **Project management** — exists in Docket (`projects.ts`, `programs.ts`, plus `cycles`, `milestones`, `hub`).
3. **Initiative management** — exists in Docket (`initiatives.ts`, `initiative-helpers.ts`; 117 files reference initiatives).

The Athena **calendar suite** (CalDAV, calendar sync, time blocks, events, agenda, moments) is to
**return after** the core three. It is captured as the Part B backlog below.

## Status legend

- **None** — Docket has no equivalent.
- **Partial** — Docket has a related but narrower/differently-shaped capability.
- **Different** — Docket solves the same need with a different model (no port needed).
- Complexity tiers are **relative** (Trivial / Moderate / Heavy), reflecting how much new schema,
  service code, and UI a port needs given Docket's modular, **org/team-scoped** architecture
  (`packages/{db,auth,authz,boundaries,env,ui}`, `apps/admin`) versus Athena's monolithic,
  **personal-scoped** `apps/api`.

---

## Part A — Launch-core gap check (Tasks / Projects / Initiatives)

Docket's versions are generally a **superset** of Athena's (it adds programs, cycles, milestones,
hub, task dependencies, agent sessions). The capabilities Athena had that Docket **lacks** in the
launch core:

| Gap | Status in Docket | Backfill | Recommendation |
|---|---|---|---|
| **Custom initiative statuses** (user-defined statuses + categories) — Athena `initiative-statuses.ts` | None (fixed status field) | Trivial (add table + CRUD) | **Most likely to want pre-launch.** Decide if Docket initiatives need user-defined statuses. |
| **Custom task statuses** (user-defined + categories) — Athena `task-statuses.ts` | Partial (fixed per-team workflow states) | Moderate (alters Docket's workflow-state model) | Likely **launch on Docket's model**; revisit only if customers demand custom statuses. |
| **Activity feed** (per-entity who-did-what) — Athena `activities.ts` | Partial (data exists in `auditEvent`/`update`, may lack read routes) | Trivial (expose read endpoints) | Verify whether Docket surfaces activity in UI; expose if missing. |
| **Audit log** — Athena `audit.ts` | Partial (`auditEvent` table exists) | Trivial (expose authed route) | Defer unless compliance needs it for launch. |
| **Cross-entity search** — Athena `search.ts` | None (no dedicated search route) | Moderate (FTS over Docket entities) | Confirm Docket's in-app search; port if there's no global search. |
| **Attachments** — Athena `attachments.ts` | Unverified | Unknown | **Verify Docket parity** — file attachments on tasks/projects are table-stakes. |
| **Notifications** — Athena `notifications.ts` | Partial (Docket has notifications) | Trivial | Verify parity; likely fine. |

**Action for launch:** confirm Docket's **attachments** and **search** parity (table-stakes), and
make a product call on **custom initiative statuses**. Everything else here is deferrable.

---

## Part B — Calendar / Athena-only porting backlog (post-core)

Sequenced **after** the launch core per direction. The dominant constraint: Docket has **no
calendar-event model at all**, and Athena's calendar features are **personal-scoped** while Docket
is **org/team-scoped** — so most of this work hinges on first introducing an events model and
deciding personal-vs-org scoping.

| Feature | In Docket? | Complexity | Athena source |
|---|---|---|---|
| **Calendar events** (recurring, all-day, RSVP/participants) — *foundation for the rest* | None | Heavy | `routes/events.ts`, `routes/events/serializers.ts` |
| **CalDAV / WebDAV server** (native iOS/macOS Calendar.app sync) | None | Heavy | `routes/dav.ts` + `services/caldav-server/` (14 files, ~3.4k LOC) |
| **Calendar sync** (Google / Outlook / iCloud / CalDAV, bidirectional) | None | Heavy | `routes/calendar-sync.ts` + `services/calendar-sync/` (7 files, ~4.5k LOC) |
| **Real-time webhook sync** (Google PubSub, Outlook webhooks) | None | (part of sync) | `routes/webhooks/{google,outlook}-calendar.ts` |
| **Agenda** (unified daily view: tasks + events + blocks + utilization) — *depends on events, time-blocks, time-tracking* | Partial (`daily-plan.ts`, narrower) | Heavy | `routes/agenda.ts`, `components/agenda/` |
| **Time blocks** (scheduled focus blocks, task linking) | Partial (`dailyPlanItem` timebox fields) | Moderate | `routes/time-blocks.ts` + `services/time-blocks/` |
| **Time tracking** (timers, time entries, summaries) | None | Moderate | `routes/time-tracking.ts` |
| **App passwords** (CalDAV client auth) | None (Docket uses passkeys) | Moderate | `routes/app-passwords.ts` |
| **RISC** (Google cross-account security-event receiver) | None | Moderate | `routes/risc.ts` + `services/risc/` |
| **Moments** (lightweight personal time slots) | None | Trivial | `routes/moments.ts` |
| **Analytics** (productivity metrics) — *depends on time-tracking* | None | Moderate | `routes/analytics.ts` + `services/analytics/` |
| **AI per-entity suggestions** (description generation, etc.) | Partial (agent-sessions, a different model) | Moderate | `routes/ai.ts` + `services/ai/` |

### Key architectural mismatches to resolve when porting

1. **Personal vs org-scoped.** Time blocks, time tracking, agenda, and moments are per-user in
   Athena; Docket is org/team-scoped. Each port needs a scoping decision (add a personal layer, or
   re-model as org-scoped).
2. **No event model in Docket.** Calendar events are a new domain (recurrence expansion, all-day,
   timezones, participants/RSVP). Events underpin CalDAV, calendar sync, and the full agenda.
3. **Auth model.** Athena used passwords + app-specific passwords (for CalDAV); Docket uses passkeys
   (WebAuthn). App passwords only matter if CalDAV ships.
4. **Status customization.** Docket uses fixed per-team workflow states; Athena allowed user-defined
   statuses (see Part A).

### Suggested Phase-2 sequence (once the core ships)

```
events  →  (time-blocks, time-tracking)  →  agenda  →  calendar-sync  →  CalDAV (+ app-passwords)
```
Moments and analytics can slot in opportunistically; RISC and per-entity AI are independent and
low-priority. Each is independently shippable behind the events foundation.

---

## How this audit was produced

Feature surfaces were compared between the Athena working tree (now `backup/*`) and Docket
(`origin/main` / `56626f9`) via route/service/schema inspection. Complexity tiers are engineering
estimates of relative effort, not committed sizings — confirm against the actual Docket schema and
auth model before scoping any individual port.
