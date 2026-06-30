# Portable Agenda Rail — Design

> **Status**: Slice 1 ready for sign-off
> **Date**: 2026-06-29
> **Supersedes**: the calendar-in-a-side-panel work from earlier today (that rail becomes the agenda)

## Context

The Today page was reworked into a calm daily landing, and the calendar moved into a shell-level
side rail (a sibling surface to `<main>`). In review, the rail's purpose grew: it should be a
**portable, flexible agenda** that replicates the core of Sunsama's daily-planning loop — not a
calendar bolted onto one page.

From the product decisions:

- **Portable** = rides along on **every page** (a persistent companion), is a **reusable surface**
  (same component can be a rail today, a full page later), and supports **draggable items**
  (reorder / timebox by dragging). *Not* a resizable/movable panel.
- **Flexible** = **switchable views**, **spans beyond today**, **editable in place**. The current
  fixed day-grid becomes *one* view, not the only one.

Backend reality (already planner-shaped):

- `dailyPlanItem` (`packages/db/src/schema/crosscutting.ts:132`): one row per task per day with
  `sort`, `status` (`planned`|`done`), and `timeboxStartsAt/EndsAt`. Cross-org, per-user (hub-scoped).
- CRUD at `/v1/daily-plan` (`apps/api/src/routes/daily-plan.ts`): list-by-date, add, patch
  (status/sort/timebox), delete. Task mutations at `/v1/orgs/:orgId/tasks/:id` (+ `/state`).
- Gaps: **no multi-day range read**, **no atomic reschedule** (delete + re-add), **no DnD library**.
- No separate "events" table — calendar items *are* timeboxed tasks (Google events import as tasks).
- `hub/today` is cross-org/global, so a global agenda is feasible from existing data.

## Slice roadmap

1. **Foundation — portable agenda surface** (this spec). Global rail + reusable `<Agenda>` + proper
   panel chrome. **No backend work.**
2. **Spans beyond today.** Day navigation (‹ today ›), grouped-by-day. Needs a multi-day read
   (fan-out per day, or a small range endpoint).
3. **Switchable views.** Agenda list ↔ day timeline ↔ multi-day, via a header switcher.
4. **Editable in place.** Complete, reschedule, set/clear timebox — adopt `/v1/daily-plan` CRUD +
   task mutations. (May enrich `DailyPlanItemOut` with task title to avoid a join in the client.)
5. **Drag-to-plan.** Reorder, drag onto a slot to timebox, drag across days. Adds `dnd-kit`.

Each slice is independently shippable. Build order is 1 → 5; 4 and 5 are the heaviest.

---

## Slice 1 — Foundation: portable agenda surface

### Objective

Turn the Today-only calendar rail into a **persistent, app-wide, reusable agenda surface** with
real panel chrome — the architecture every later slice builds on — without changing the day's
content rendering or touching the backend.

### Scope (in)

1. **Rides everywhere (global registration).** Move rail registration off the Today page and into the
   shell frame, so the agenda shows on every authenticated page.
   - New effect-only `AgendaRail` registrar rendered inside the shell (a descendant of
     `ShellAsideProvider`), which calls `useShellAside().setAside(<Agenda/>, 'Agenda', <glyph/>)` once
     and clears on unmount. Wire it into `AppShellInner` (`apps/web/src/components/app-shell-frame.tsx`)
     alongside `children`, so it mounts for every route.
   - Remove the Today page's `setAside` registration; the Today page keeps only masthead + prompt +
     Next up.
2. **Reusable `<Agenda>` component.** New `apps/web/src/components/agenda/agenda.tsx` — self-contained,
   fetches its own data via a shared `useAgenda(date)` hook (today for now), renders the day. It must
   render correctly anywhere it's mounted (rail now; full page / peek later), depending only on app
   providers (react-query, active-org), not on the Today route.
   - **Data source for Slice 1 stays `hub/today`** (it already carries task titles + timeboxes, and
     dedupes with the Today page's "Next up" via the same `queryKeys.today(date)`). Adopting the
     editable `/v1/daily-plan` CRUD is deferred to Slice 4, where a title-enrichment may be needed.
   - View content is **unchanged** for Slice 1: reuse the existing day-timeline (`CalendarPane`) as
     the single view. (Agenda-list / untimed-task rendering is Slice 3.)
3. **Proper panel chrome (retire the floating toggle).** The shell rail gets:
   - a **header**: the `asideLabel` ("Agenda") as a title, plus a **collapse** control (a labeled
     icon button — obvious function, lives *in* the panel so it costs no horizontal space when open);
   - a **reopen tab** at the right edge shown **only when collapsed** (so it costs nothing when open),
     using the page-supplied glyph so its purpose is obvious;
   - **remove the seam-handle** added earlier (vertically-centered chevron — read as random and stole
     width when open).
   - Keep: shown-by-default on `lg`, the width open/close animation, the mobile Sheet + top-bar
     trigger.
4. **Rename** the rail's identity from "Calendar" → "Agenda" (`asideLabel`, glyph stays the calendar
   icon for now).

### Scope (out — later slices)

Multi-day, day navigation, view switching, any editing/mutations, drag-and-drop, adopting the
`/v1/daily-plan` CRUD, a full-page agenda. None of these in Slice 1.

### Files

**New**
- `apps/web/src/components/agenda/agenda.tsx` — reusable `<Agenda>` (day view; reuses `CalendarPane`).
- `apps/web/src/components/agenda/use-agenda.ts` — `useAgenda(date)` data hook (wraps the `hub/today`
  query; shares cache with Today's Next up).
- `apps/web/src/components/agenda/agenda-rail.tsx` — effect-only global registrar.

**Modified**
- `apps/web/src/components/app-shell-frame.tsx` — render `<AgendaRail/>` inside `AppShell` (global).
- `packages/ui/src/components/shell/AppShell.tsx` — replace the seam-handle with in-panel header
  (title + collapse) and an edge reopen-tab; keep the animated rail + mobile Sheet/trigger.
- `apps/web/src/app/(app)/today/page.tsx` — drop the rail registration (no more `setAside`/calendar
  imports here); page is just masthead + prompt + Next up.

**Reused (no change):** `CalendarPane` (the day-timeline view), the `ShellAsideContext` API
(`setAside`/`open`/`mobileOpen`/`toggle`/`asideIcon`), `useShellAside`, `hub/today` query +
`queryKeys.today`.

### Risks / considerations

- **Global rail on dense pages.** Detail pages (project/cycle/session) already have an in-`main`
  property panel; the agenda rail adds a third column. Mitigated by: rail collapses, and `<main>` is
  a container-query context so its content reflows. Acceptable; revisit if a page feels cramped.
- **Registration ownership.** Exactly one registrar (the global `AgendaRail`) must own `setAside`;
  ensure the Today page no longer registers, or they'll fight (last-writer-wins).
- **Collapse focus.** Collapsing moves focus off the in-panel collapse button (it becomes `inert`);
  acceptable for Slice 1 (focus falls to body, reopen tab is tabbable). Tidy focus-return is a
  follow-up.

### Verification

- `pnpm typecheck` + `pnpm lint` clean for changed files; `@docket/web` + `@docket/ui` test suites
  unchanged (no new failures beyond the known pre-existing token-drift in `@docket/ui`).
- Manual (browser, `/today` and one other route, e.g. `/inbox`):
  - The agenda rail appears on **both** pages (rides along), open by default on a wide window.
  - Header shows "Agenda" + a collapse control; collapsing slides it closed (animated) and leaves a
    reopen tab at the edge; reopening slides it back. No floating control when open.
  - Today's masthead has **no** calendar toggle anymore; Next up still renders.
  - Narrow window: rail is a right Sheet opened from the top-bar trigger.
  - Navigating between routes keeps the rail (doesn't flicker/re-register); it shows the same day.
