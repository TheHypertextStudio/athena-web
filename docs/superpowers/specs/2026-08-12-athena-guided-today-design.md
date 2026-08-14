# Athena-guided Today

> **Status**: Approved in conversation; awaiting final written-spec review
> **Date**: 2026-08-12

## Objective

Today becomes the place where a person starts and steers the day. It must answer, with equal
weight:

1. **What needs my attention?**
2. **What should I do now, and what follows it?**

The page is not a dashboard, a duplicate calendar, or a full backlog. It is a calm, finite daily
operating surface. Athena interprets the day and helps reshape it; Docket remains the durable
system of record for tasks, plans, timeboxes, approvals, Projects, Initiatives, and updates.

## Why the current page fails

The route already receives more useful data than it shows: a cross-workspace plan, timeboxes,
approvals, blockers, due work, and inbox load. Separate scheduling contracts can also distinguish
an ungenerated agenda from a generated-but-empty one and recommend the current focus. Yet the
empty state renders a capture line, “Nothing planned yet,” and a link to Tasks across a large blank
canvas.

That leaves four user questions unanswered:

- Is today unplanned, intentionally empty, or already complete?
- What should I do now?
- What comes immediately after it?
- What larger work is moving, stale, or at risk because of today's tasks?

Athena is also visually absent. A generic “Replan day” button would make the page look like an
ordinary task dashboard with AI hidden behind it. Athena must be a clear interaction surface and
the visible intelligence behind planning and suggestions.

## Product principles

### Athena interprets; Docket records

Athena may explain priorities, suggest a plan, offer feasible work, and conduct a replanning
conversation. Those suggestions are grounded in Docket data. Applying a suggestion mutates the
same durable task, daily-plan, calendar, and approval records used everywhere else.

Athena never invents progress, project health, milestone state, or recent movement. Status copy is
drawn from durable updates and rollups. Where those do not exist, the card says so plainly.

### Compact action, detailed workflow

Today supports the same common inline actions available elsewhere: start focus, mark work done,
defer, reorder, timebox, accept a simple suggestion, and open a task. It does not reproduce task
detail, calendar editing, approval diffs, project documents, or initiative management. Those open
the corresponding full surface with the user's place preserved.

### The page stays finite

Today shows one current item, one following item, at most four work-status cards, and at most three
momentum suggestions. It does not become another all-tasks view. Empty sections do not render.

### One chronological surface

The existing shell agenda rail remains the chronological representation of the day. Today shows
the decisions and work; the rail shows their time shape. The page never renders a second calendar
or chronological timeline beside it.

## Page hierarchy

### 1. Compact heading

The route keeps a compact `Today · <weekday, month day>` heading. It must not become a marketing
masthead. The first substantial interactive element is the Athena field.

### 2. Athena field, always present

The top field is visibly an Athena conversation entry point. It accepts plain language such as:

- “Plan my morning.”
- “Move deep work after lunch.”
- “What should I tackle before the board call?”
- “Capture follow up with Sam.”

Athena is the default destination. A secondary destination control retains deterministic task
capture for someone who explicitly wants one task created without interpretation. The control
always names its consequence; the app never guesses whether text should become a task or an agent
session.

Submitting to Athena expands the field in place into the full shared Athena session. The resting
Today content steps out, and the session occupies the main content pane while the global shell and
agenda rail remain. This is the same persistent conversation used by the Athena dock and dedicated
Athena surface, not a Today-only thread.

Collapsing the session restores Today, leaves a compact receipt for ongoing or recently completed
work, and refreshes the daily projection. The field/session transition uses the existing view
transition and becomes instant under reduced motion.

Immediately beneath the resting field, Athena may show one concise, grounded sentence about the
day, such as “Two commitments need you before the rest of the plan can move.” It links to the
specific item instead of expanding into a permanent analytics panel.

### 3. Plan affordance when the day has no plan

Today must distinguish three states:

- **Unplanned**: no generated or accepted plan exists for the date.
- **Active**: an accepted plan exists and at least one incomplete item remains.
- **Cleared**: planning ran for the date but placed nothing, or every retained plan item is done.

`not_generated` with no personal daily-plan items produces **Unplanned**. A generated week that
placed nothing (`empty_week`) is **Cleared**, not Unplanned: planning did happen, and Athena should
offer feasible additional work rather than asking the person to repeat it. If every item is
removed and no planning receipt remains, the day returns to Unplanned; the app must not infer prior
intent from missing rows.

When the day is Unplanned, a prominent card appears directly below the Athena field:

> **Plan today with Athena**
>
> Fit priorities and deadlines around the time you actually have.

The action expands the field into the Athena session with the planning intent and date already in
context. Athena considers the user's existing daily plan, assignments, priority, due and start
dates, dependencies, estimates, scheduling preferences, protected time, external events, and week
plan. It produces a concrete proposed order and timeboxes, including an honest unplaced list when
the day is overfull.

The proposal is reviewable before it changes Docket. The existing trust policy determines whether
an authorized proposal may apply directly or waits for approval. Manual edits always win over the
generated order. Athena never silently drops, completes, or reschedules work.

### 4. What's next

Once a plan exists, the primary working section is a two-step sequence:

- **Now**: the active focus session, the timebox covering the current moment, or the first
  actionable planned item.
- **After this**: the next unblocked incomplete item in accepted plan order.

Each item shows only information that helps make the next decision:

- title and workspace;
- scheduled time or estimated effort when known;
- a brief, deterministic reason such as “scheduled now,” “you chose this first,” “due today,” or
  “unblocks two tasks”;
- current task state and any blocking condition.

Now has stronger visual weight; After this is a quieter continuation, not a peer card. If an
approval or blocker prevents the planned next action, the intervention replaces that position and
names what must happen. Approvals that require a diff open the full review; Today exposes only safe
approve/reject actions already supported by the shared approval component.

Inline actions are:

- start or resume focus;
- mark complete;
- defer out of today;
- reorder Now and After this;
- set or adjust a simple timebox;
- open the full task.

Actions use shared semantic mutations. “Complete” must update the Task's real workflow state and
the daily-plan representation consistently; it must not merely paint the Today row as done while
leaving the task open. If the existing route set cannot guarantee that semantic action in one
server operation, implementation adds a purpose-built Today action rather than coordinating a
fragile browser-side fan-out.

Every successful mutation invalidates the Today, daily-plan, directive, agenda, and relevant task
caches together so the main pane and agenda rail cannot disagree.

### 5. Work in motion

Below What's next, Today renders up to four Project or Initiative status cards. Their purpose is to
connect today's execution to the larger outcomes it advances—not to recreate Portfolio.

Selection is deterministic and server-side. It prefers, in order:

1. entities attached to Now or After this;
2. active entities with work in today's accepted plan;
3. at-risk, off-track, or stale entities visible to the user;
4. entities with a recent durable update or approaching milestone.

The selector de-duplicates related Initiative and Project cards when they would repeat the same
story and limits over-representation from one workspace when equally relevant work exists
elsewhere.

Each card carries:

- entity kind, title, and workspace identity;
- health and lifecycle status;
- the latest durable update excerpt and its age, or an explicit “No update yet” state;
- the next dated milestone or target when present;
- Project task progress, or Initiative connected-work health, when that rollup exists;
- one contextual action and a link to the full entity surface.

The cards are editorial rather than metric tiles: a clear title, a meaningful status sentence, a
restrained progress or health treatment, and a quiet workspace/entity-display color accent.
Healthy work is visually quiet. At-risk, off-track, and stale work receive stronger semantic
emphasis without flooding the page with warning color.

At wide widths the cards use a two-column grid with deliberate variation between Project progress
and Initiative health composition. At narrow widths they become one ordered column. The page does
not use a horizontal carousel, which would hide status and introduce a second navigation gesture.

### 6. Keep the momentum

When a plan exists but no actionable item remains—because every item is complete, removed, or no
longer feasible—Athena proactively offers up to three additional tasks that can genuinely fit the
remaining day.

Suggestions are grounded by a deterministic candidate service before Athena presents them. It
excludes completed, canceled, archived, blocked, invisible, and already-planned tasks. Ranking
considers dependency impact, priority, due date, planned/start date, estimate, recent context, and
remaining availability. A suggestion that cannot fit is not shown as feasible.

Each suggestion states why it is relevant and offers:

- **Start now**: add to Today, make it Now, and optionally begin focus;
- **Add to today**: add in the next available position without starting;
- **Open task**: inspect the detail first;
- **Dismiss**: hide it for the current Athena session without mutating the task.

This section is not shown for the Unplanned state; the prominent Plan today affordance owns that
case. It appears for Cleared days and for Active plans whose remaining items are all temporarily
inactionable. If no feasible tasks exist, Athena says the day is clear and offers capture or
planning a future day instead of manufacturing work.

## Read model and data flow

Today should not issue one browser request per workspace, Project, Initiative, update, and
milestone. Extend the Hub Today projection into a bounded, visibility-filtered briefing read.

The exact DTO names may follow repository conventions, but the response needs these concepts:

```ts
type HubTodayBrief = {
  date: string;
  planState: 'unplanned' | 'active' | 'cleared';
  brief: {
    sentence: string;
    attentionCount: number;
  };
  focus: {
    now: TodayFocusItem | null;
    after: TodayFocusItem | null;
  };
  statusCards: TodayStatusCard[]; // max 4
  momentumSuggestions: TodaySuggestion[]; // max 3
  plan: HubTaskItem[];
  calendar: HubCalendarBlock[];
  needsAttention: HubNeedsAttention;
};
```

`TodayFocusItem` includes the task and daily-plan identifiers, source/provenance, reason code,
timebox, actionable state, workspace label data, and URLs needed for inline and detailed actions.
`TodayStatusCard` is a deliberately compact union of Project and Initiative variants rather than a
bag of optional fields. `TodaySuggestion` carries rank reasons and fit information produced by the
deterministic candidate service.

The server composes this projection from existing daily-plan, directive, time-anchor,
Project-overview, Initiative-overview, update, and milestone logic. Shared selectors move into
services rather than importing route handlers. Every row passes the same resource-visibility and
tenant filters as its dedicated surface; simple organization membership is not sufficient for
private or guest-scoped entities.

The web data layer exposes query definitions and mutation hooks in a focused Today module. Page
components receive typed data and callbacks; they do not call `api.v1.*` directly. Mutations patch
optimistic state only where the action is reversible and unambiguous, then reconcile from the
server response.

## Component boundaries

- `TodayPage`: switches between resting Today and the expanded shared Athena session.
- `TodayAthenaComposer`: always-present entry point, deterministic Task/Athena destination, brief
  sentence, session transition, receipt, and local submission errors.
- `PlanTodayCard`: renders only for Unplanned and opens Athena with planning context.
- `TodayFocusSequence`: owns Now and After this ordering and delegates a row's safe actions.
- `TodayFocusItem`: one task/intervention with shared task, focus, timebox, and approval controls.
- `TodayStatusGrid`: bounded layout only; it does not select or fetch entities.
- `TodayProjectStatusCard` / `TodayInitiativeStatusCard`: variant-specific durable status grammar.
- `TodayMomentum`: complete-day suggestions and their accept/dismiss behavior.

These replace the current generic `TodaysWork` presentation. Existing shared components and hooks
should be reused where their semantics match; Today must not fork task completion, time tracking,
approval, or timebox behavior.

## Loading, empty, and error states

- The heading and Athena field paint immediately; known interface copy is never replaced by a
  skeleton.
- Focus and status sections use shape-matched skeletons that reserve final geometry.
- A Today projection failure leaves deterministic capture and the Athena entry point available.
- Athena/session failure leaves the accepted plan operable and uses application-owned error copy.
- The UI never renders exception text, provider messages, Problem `title`, or Problem `detail`.
- A workspace with no tasks, Projects, or Initiatives receives useful next actions: capture work,
  connect a calendar, or create a Project. It does not receive fake status cards.

## Accessibility, responsive behavior, and motion

- All interactive controls meet the repository's touch-target floor and retain visible keyboard
  focus.
- Now/After this order is semantic in the DOM and does not depend on color or spatial position.
- Health, risk, completion, and Athena provenance have text or icon-label equivalents.
- Reordering supports keyboard controls and announces the new position.
- Status cards are links only at their explicit title/action regions; nested controls do not create
  invalid click targets.
- At narrow widths, actions collapse into a labeled overflow while the primary action remains
  visible. The floating Athena launcher must not cover Today content.
- Light and dark themes preserve semantic emphasis rather than inverting colors mechanically.
- Session expansion, task completion, and plan reorder use restrained shared motion; reduced-motion
  users receive instant state changes with identical feedback.

## Validation

### Projection and service tests

- Plan-state tests distinguish Unplanned, Active, and Cleared, including `empty_week`, all-done,
  and all-removed cases.
- Focus selection tests cover active tracking, current timebox, accepted order, blocked work, and
  After-this fallback.
- Status selection tests prove relevance order, de-duplication, maximum four, workspace diversity,
  durable-update fallback, and visibility filtering.
- Momentum tests prove excluded states, dependency safety, fit within remaining availability,
  deterministic order, and maximum three.
- Cross-tenant and guest/private-resource tests prove Today cannot surface an entity or task hidden
  from its dedicated route.

### Component tests

- Athena field is always present and expands/collapses into the shared session.
- Task mode remains deterministic and explicitly labeled.
- The planning card appears only for Unplanned and starts the session with date/context.
- Now and After this render in order with reasons and correct inline actions.
- Project and Initiative cards render variant-specific fields and honest missing-update states.
- Cleared plans show grounded momentum suggestions; Unplanned does not.
- Local loading, retry, unavailable-Athena, and empty-workspace states remain operable.

### Mutation and integration tests

- Completing from Today updates both the real task workflow and the daily projection.
- Reorder, defer, and timebox mutations keep Today, directive, daily-plan, task, and agenda caches
  consistent.
- Applying an Athena plan respects approval/trust policy and preserves manual overrides.
- Expanding Today and opening the Athena dock resolves to one persistent session.

### End-to-end and craft review

Exercise a real cross-workspace flow for an unplanned morning, accepted plan, active Now item,
completed day with proactive suggestions, and a status card opening its entity surface. Run the
Docket Craft Rubric against Today at desktop and mobile widths in light and dark themes, including
keyboard order, focus, touch targets, overflow, reduced motion, and the expanded-session state.

## Out of scope

- Replacing the global agenda rail.
- Building a second calendar or full task list on Today.
- Full approval diffs, task detail, Project documents, or Initiative management inline.
- Model-generated project health or status updates.
- A new Athena conversation separate from the persistent personal session.
- Reworking the shared sidebar information architecture as part of this slice.

## Success criteria

A user opening Today can immediately talk to Athena, tell whether the day is planned, identify the
one thing to do now and the thing after it, understand how current Projects and Initiatives are
moving, take common actions without navigation, and receive grounded additional work only when the
accepted day has genuinely run out.
