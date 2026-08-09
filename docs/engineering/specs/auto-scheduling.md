# Weekly auto-scheduling and the daily loop (area: `scheduling`)

> **Status**: implemented.
> **Last Updated**: 2026-08-02
> **Companions**: `curfew-integration.md` (the directive feed's coupling boundary, which this
> implements Docket's half of), `time-tracking.md` (the Time Ledger this learns durations from),
> `calendar-architecture.md` (the calendar these blocks are ordinary rows on), `data-layer.md`
> (the query layer the web surfaces read through).

---

## 0. The premise: time is not fungible

The goal this feature exists for, in the author's own words, is to schedule all of the following
into a single week automatically and with very little input:

> Filming sessions for Las Vegans for Better Transit; Meetings for various community members for
> LVBT; Time to write and plan longer-term stuff; Time to simply read while doing something like
> waiting to get somewhere on a bus; Reflecting on meetings and debriefing on events;
> Brainstorming architecture of apps and services.

These are six **qualitatively different** kinds of time, and the single most important design
decision here is that they are not modelled as one generic block with a label on it. A scheduler
that treats them as interchangeable will cheerfully put a three-hour shoot in a 25-minute bus ride
and a paperback in a studio, produce a week that is technically full, and be abandoned in a day.

So the taxonomy is the feature.

| Shape                     | Placement          | Window            | Requires       | Default | Why it is its own kind                                                                                         |
| ------------------------- | ------------------ | ----------------- | -------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `filming_session`         | contiguous         | `field`           | a location     | 180m    | A shoot needs a crew call, setup and teardown; it cannot be split and it happens somewhere specific.           |
| `community_meeting`       | contiguous         | `field`           | attendees      | 60m     | Other people's time is in it. A meeting with nobody in it is not a meeting.                                    |
| `deep_writing`            | contiguous         | `desk` (or field) | —              | 120m    | Value comes from being unbroken. Three restarts is three warm-ups and no writing.                              |
| `interstitial_reading`    | **interstitial**   | `transit` only    | —              | 20m     | The whole point is that this time is otherwise thrown away. Reading at a desk is the block you skip.           |
| `reflection_debrief`      | **anchored after** | `desk` (or field) | a source event | 15m     | It is not scheduled against the clock; it is scheduled against the thing it reflects on, and links back to it. |
| `architecture_brainstorm` | contiguous         | `desk` (or field) | —              | 90m     | Mid-length exploratory work; expands to fill available slack, which is what makes it a good backfill shape.    |

The table is a **total map** in `packages/types/src/scheduling.ts` (`WORK_SHAPE_PROFILES`), so
adding a seventh shape is a compile error until it is described. That is the only reliable way to
stop a new kind of time from silently inheriting generic "one hour somewhere" behaviour.

---

## 1. The availability model

Availability is declared as recurring weekly windows, each of one kind:

- **`desk`** — focused seated work.
- **`field`** — out in the world: shoots, in-person meetings.
- **`transit`** — travel and waiting. Only interstitial shapes may consume it.
- **`personal`** — protected. The scheduler never places work here.

**Protection is structural, not a priority.** `expandAvailability` subtracts personal windows from
every other kind _before_ the planner runs, so there is no code path in which a work block can land
in protected time — the minutes do not exist in the allocation pool. Time in no window at all is
unavailable for the same reason. This is what makes "the scheduler never places work inside
declared personal windows" a property rather than a policy, and it is asserted across ten generated
weeks in `apps/api/tests/services/scheduling/week-planner.test.ts`.

**Travel time is discovered, not declared.** The interesting reading time is the gap between two
commitments _in different places_ — the bus ride, the wait in a lobby. `detectTransitGaps` finds
those from the day's own calendar: two items on the same local day, both with a location, the
locations differing, and a gap between the configured minimum and maximum. Discovery
**reclassifies** rather than adds: minutes an inferred gap shares with a declared desk window
become transit, because you cannot be at a desk while you are on the bus. And protection outranks
discovery — a gap that lands inside a protected lunch is not travel time.

`defaultAvailabilityWindows()` is a documented default, not a hidden fallback: weekday desk hours
with a protected lunch, protected evenings and Sundays, Saturday field time, and weekday commute
windows. It exists so the very first planning run produces a real week, and every value in it is
visible at `GET /v1/schedule-week/preferences` and editable.

---

## 2. Standing commitments — where "extremely little input" comes from

A **commitment** is a standing weekly ask: a shape, a title, a workspace, how many sessions a week,
optionally how long, a location, attendees. It is written once (`PUT /v1/schedule-week/preferences`)
and produces blocks every week thereafter without further prompting.

Two policy switches remove the rest of the per-item input:

- `reflectionForMeetings` — every meeting-shaped block in the week, and every pre-existing calendar
  event with attendees, automatically gets a debrief placed after it and linked to it. Without this
  the person would enumerate "and a debrief after each of those" every week.
- `backfillShapes` — which shapes may absorb leftover availability, so the person never has to say
  "and put the spare afternoons into writing".

The result is that `POST /v1/schedule-week` takes **no required body at all** and asks nothing. The
response reports `userInputCount` (1) so the claim is a number in the payload rather than an
assertion in a document.

---

## 3. The planner

`planWeek` (`apps/api/src/services/scheduling/week-planner.ts`) is pure: same inputs, same week. No
model call, no ambient clock. That is what makes "does it ever place work in protected time?" a
question a test can answer a hundred times instead of a question of trust.

Passes, in order, and why that order:

1. **Requirement checks.** A filming commitment with no location and a meeting with no attendees are
   reported as unplaced _before_ any placement runs, so a missing location is never reported as
   "the week was full".
2. **Contiguous commitments, longest first.** First-fit-decreasing. Shoots and meetings are the
   least movable things in the week and the longest, so they claim their field windows first. A
   meeting is only placed somewhere its **debrief also fits** — a meeting that leaves no room to
   debrief has not really been scheduled — falling back to a tighter placement only if the week is
   genuinely that constrained. Repeated sessions of one commitment spread across distinct days.
3. **Reflection.** Derived, never asked for.
4. **Interstitial reading.** Longest travel stretch first, because the value of interstitial time
   scales with its length: a 60-minute bus ride is where a chapter gets read; a 10-minute walk is
   where a bookmark gets moved. If there is no travel that week there is **no reading**, and the run
   says so rather than inventing a desk block.
5. **Backfill.** The largest remaining hole, absorbed by whichever backfill-eligible shape accepts
   its window kind, rotating between them, until no hole exceeds `maxUnplannedGapMinutes`.

Anything that could not be placed comes back in `unplaced` with a stable machine reason code
(`missing_location`, `missing_attendees`, `no_matching_window`, `window_too_short`, `week_full`) —
never silently dropped. The UI owns the sentence.

### Durations come from measured time

`estimateSessionMinutes` resolves a session length in this order: this exact task's own tracked
history (≥2 sessions), the shape's history across every task (≥3), what the commitment asked for,
then the shape default — always clamped into the shape's own bounds, so a runaway timer cannot
produce a six-hour writing block. It uses the **median**, not the mean: one four-hour session that
was really "forgot to stop the timer" would drag a mean permanently upward.

Sessions are read from the Time Ledger (`time_record` ⋈ `time_interval`, closed records only — an
open session has no length yet and counting one would under-estimate everything downstream). Every
block reports its `durationSource`, so a person is never shown a confident estimate built on
nothing.

### Coverage

The report states total available minutes inside declared windows, minutes carrying a plan,
coverage as a percentage, **protected minutes deliberately left alone**, every remaining gap above
the threshold, and the longest one. Minutes consumed by a shape's protective buffer (a shoot's
teardown) count as committed, because they are.

---

## 4. Persistence

Generated blocks are **ordinary calendar items** — `kind: 'native_block'` on the user's native
layer — so they appear on the same calendar as everything else rather than in a parallel universe.
Three additive columns carry the attribution:

- `calendar_item.work_shape` — the shape, or null for anything unshaped.
- `calendar_item.origin` — `user` (a manual gesture) / `scheduler` / `agent` / `provider`, defaulting
  to `user` so every pre-existing row keeps the only attribution that was ever true of it.
- `calendar_item.schedule_run_id` — which run placed it.

**The scheduler only ever deletes its own work.** A regeneration clears rows with
`origin = 'scheduler'` for that week and nothing else, so a block a person dragged onto the calendar
survives every future run. Debriefs link to their source through the existing
`calendar_item_relation` primitive with role `follow_up`, so the link is visible to every other
calendar surface.

New tables (all additive, `packages/db/src/schema/scheduling.ts`, migration
`0060_weekly_scheduling_and_directive.sql`): `scheduling_preference`, `schedule_run`,
`day_directive`, `day_check_in`, `day_review`, `directive_acknowledgment`.

---

## 5. The daily loop

The loop is: **wake → agenda → check-ins → dynamic reorganization → end-of-day review**, published
through a generic directive feed at `/v1/directive`.

### The boundary (this is `curfew-integration.md` §0, implemented)

Nothing in the directive surface — no route, column, type, field, or machine code — names or models
any particular device-control client. Docket publishes **content and conditions**:

- a `posture` (`on_track` / `attention_needed` / `intervention_recommended`),
- a plain-language `reason` safe to show verbatim,
- at most one `recommendedAction` naming the one thing worth full attention,
- and **gates**: `{ kind, state: 'open' | 'holding', outstandingSteps }`.

A gate states a condition and never a mechanism. What "holding" costs a person — a full-screen
overlay, a focus mode, a browser extension, or simply a reminder — is entirely the consumer's
decision. There is no vocabulary here for "lock", "block app X", or "run command Y", and there must
never be one. A test asserts the serialized gate contains no enforcement word.

**One honest tension, recorded rather than papered over.** The goal text asks for Docket to
"proactively stop me from doing other work". `intervention_recommended` plus a narrowing
recommendation is as far as this design goes, deliberately, and matches the committed
`curfew-integration.md` §5 position. Closing the remaining distance is a product decision about the
consumer's enforcement, not an API gap.

### Posture

`computeDirectivePosture` is a deterministic schedule-adherence check over timeboxes and the wall
clock. No model call, no probability. Zero overrun items → `on_track`; one overrun, or the current
block within 15 minutes of its end → `attention_needed`; two or more overrun, or one overrun by more
than 30 minutes → `intervention_recommended` with the longest-overrun block as the recommendation.

It is intentionally unambitious: it is a schedule check, not a judgment about whether the work
matters, and the copy it produces says so — it names a block and a number of minutes.

The day's `directiveId` is regenerated **only when the posture changes**, so a consumer that
acknowledges an id is acknowledging the state it actually saw, and a healthy day produces no churn.

### Day start

`GET /v1/directive/day-start` returns readiness (`ready` / `not_generated` / `empty_week`), the
agenda, and the `day_start` gate. **A not-ready day returns a reason, never an empty agenda** — an
empty array would be indistinguishable from a genuinely clear day, and a consumer would release its
gate on a day that was simply never planned.

`POST /v1/directive/day-start/acknowledge` fires the morning release signal **exactly once**: the
write is conditional on the signal being absent, so a retried call returns `fired: false` with the
original timestamp. A day whose agenda is not ready is refused.

### Check-ins

Materialized once per day, anchored to block boundaries (the honest moment to ask "did that land?"
is when something was supposed to finish) and topped up on a cadence, with a floor of three per work
day and a cap of eight. Rows exist ahead of time so a **non-response is recordable**: a check-in
that came due and was never answered is a fact about the day, not missing data. They are
materialized once and then left alone — re-deriving them after the day changes shape would produce a
different set of times and the day would accumulate check-ins.

### Dynamic reorganization

`POST /v1/directive/reorganize` re-cuts the rest of the day. The restraint is the design: only
blocks that have **not started yet** and that the **scheduler itself placed** are movable. Anything
in progress, already done, hand-placed, or synced from an external calendar is fixed. A block whose
slot survived keeps it and is not reported as moved, so a reorganization never becomes a
rearrangement of a day that did not need one. Movable blocks keep their durations and their shape's
window rules, so a shoot is never re-cut into desk hours. What no longer fits is **archived, not
deleted**, so the evening review still sees it.

When the day has slipped, the block being worked is the **earliest overrun** one — not whichever
block's window happens to contain the clock, because on a slipped day that block is precisely the
one nobody has started.

### Proactive re-cutting defaults ON, for every Hub

`POST /v1/directive/reorganize` is the button, but it is no longer the only caller.
`sweepDayCadence` (`POST /internal/cron/day-cadence`, provisioned at `*/5 * * * *`) re-cuts the
rest of a Hub's day **without being asked** whenever `assessDrift` says the day has genuinely
slipped, subject only to a cooldown.

**`scheduling_preference.auto_reorganize_on_drift` defaults to `true`.** Migration
`0077_day_cadence_config.sql` added the column `DEFAULT true NOT NULL`, so every Hub that already
had a `scheduling_preference` row got proactive re-cutting turned on at migration time, and
`loadSchedulingPreferences` returns `true` for a Hub with no row at all. There is no opt-in step
and never was one: a person who has never opened a settings screen has a calendar that rearranges
its own afternoon.

That is deliberate, not an oversight. A chief of staff who notices the day has come apart and then
waits to be asked before doing anything about it is not doing the job — proactive re-cutting is the
capability this whole area exists to deliver, and shipping it off-by-default would have shipped it
to nobody. The restraints above are what make it safe to have on: only future, scheduler-placed
blocks move, nothing in progress or hand-placed or externally synced is touched, displaced work is
archived rather than deleted, and the cooldown stops a five-minute tick from becoming a schedule
that rearranges itself under you.

**Turning it off — two switches that do different things.** They are worth stating separately
because turning off the wrong one leaves the behaviour running and only removes the evidence.

1. **Stop the re-cut.** `PUT /v1/schedule-week/preferences` with
   `{"autoReorganizeOnDrift": false}`. `sweepDayCadence` reads it per Hub per pass, so drift is
   still assessed and still reflected in the posture, and `POST /v1/directive/reorganize` still
   works on request — the day simply stops being re-cut unasked. **This is API-only today.** The
   field is on `SchedulingPreferencesOut`/`SchedulingPreferencesUpdate` and the web app reads it
   (`use-schedule-plan.ts`), but no surface writes it, so in practice a person cannot yet reach
   this switch from the product. That gap is the honest cost of the default and is listed in §7.
2. **Stop the announcement only.** Settings → Notifications → the **Workflow** row's **Web**
   checkbox. `announceReorganization` dispatches with `category: 'workflow'`, `channels: ['web']`
   and no `preferenceMode`, so channel resolution defaults to `respect_user_preferences`;
   `workflow` is not a locked category (`lockedPreference` locks only `security` and `account`),
   so the toggle really does suppress the notification, with reason `user_disabled_channel`. **The
   re-cut still happens.** Unchecking this box does not calm the calendar down, it makes the
   calendar move silently — which is the opposite of what someone reaching for it usually wants,
   and the reason switch 1 is the real kill switch.

### End of day

A defined three-step flow, all required, because "reflect on your day" as an empty textarea is a box
people stop filling in by Thursday:

1. **Reconcile** — every unfinished block gets a decision: done after all, rescheduled to a named
   date, or dropped _with a reason_. The DTO enforces both conditions, so the release signal cannot
   be reached by dispositioning items meaninglessly.
2. **Reflect** — three fixed questions (what moved, what got in the way, what should be different
   tomorrow), so a review is comparable day to day.
3. **Confirm tomorrow** — explicit, never implicit. Refused while an earlier step is outstanding.
   Nothing auto-accepts a proposal; that is the difference between "the system planned tomorrow" and
   "the person intended tomorrow".

The `day_end` gate names whichever steps remain and opens only when none do.

---

## 6. Surfaces

`/plan` (`apps/web/src/components/scheduling-plan/`) carries three lenses over the same loop:

- **The week** — the seven-day board, the legend of kinds actually present, the coverage report, and
  everything unplaced with its reason.
- **Start of day** — the agenda walked one block at a time with keep / move out / drop, the gate and
  what it waits on, the posture and its reason, and the day's check-ins.
- **End of day** — the three-step review.

`?date=` and `?lens=` make the surface addressable, which is what a day-start deep link needs.

Every read goes through the typed TanStack layer (`use-schedule-plan.ts`); every mutation invalidates
the coarse `['me','plan']` prefix, because the week, the directive, the check-ins and the review are
four views of one day and a partial invalidation is exactly how one ends up disagreeing with the
others. All failure copy is application-owned; no server sentence is ever rendered.

---

## 7. What is not built

- **No MCP resource yet.** `curfew-integration.md` §3.2 specifies `docket://hub/directive` and an
  `acknowledge_directive` tool. The computation, persistence and REST surface all exist and are
  shared; registering the MCP resource/tool over the same service is the remaining step, and it adds
  no new logic.
- **No `notifications/resources/updated` push.** Posture is swept on a 5-minute timer
  (`sweepDirectivePosture`) and acted on by `sweepDayCadence` at the same cadence, and a consumer
  polling the feed always sees a current value — but nothing is pushed over MCP, because there is
  no MCP resource to push (see the first bullet).
- **No settings surface for `autoReorganizeOnDrift` or `checkInCadenceMinutes`.** Both are per-Hub
  columns carried through `PUT /v1/schedule-week/preferences`, and the web app reads preferences
  but writes none of them. Until a surface exists, the kill switch for the proactive re-cutting
  described in §5 is reachable only through the API.
- **No LLM-driven posture.** Explicitly deferred, per the companion spec.
- **No timezone-aware `?date` inference for a consumer in another zone.** The day is always resolved
  in the Hub's own timezone.
