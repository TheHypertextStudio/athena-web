# Stream Context Timeline

## Objective

Stream answers one question: **What happened here?**

“Here” is the current product context. On a workspace route it means every event in that
workspace. On the Hub route it means every event in the workspaces the viewer can access, with
workspace attribution. A future embedded Stream may bind the same model to one Docket entity.

Stream is not a personalized attention queue. Triage already answers “What needs me?” Stream is a
chronological record for situational awareness: work moving, decisions being recorded, people and
agents acting, and connected tools reporting changes.

The redesign keeps chronology primary while lightly clustering nearby events about the same thing.
Every substantive change remains visible as its own line. Duplicate and mechanical activity may be
collapsed, but never at the cost of hiding a decision, outcome, ownership change, or other meaningful
transition.

## Current problem

The current UI renders the event table too literally:

- Every canonical event receives an equally weighted row, so a four-edit burst looks like four
  separate stories.
- The subject title, actor, source, and time are repeated on every row even when neighboring events
  concern the same thing.
- The actor's display name appears in both the sentence and metadata. The viewer sees their full
  name instead of the natural “You.”
- Typed details exist for field changes, state transitions, timers, agent milestones, and external
  events, but the row often degrades them to labels such as “Description.”
- The generic group/sort toolbar exposes database-oriented controls instead of reinforcing a
  timeline's fixed information model.
- The Hub Stream is relevance-curated through `event_recipient`, which makes it overlap with Triage
  rather than represent the Hub context.

The underlying event contract is already rich enough to solve most of this. `EventOut` carries the
canonical entity, actor identity, source, kind, occurrence time, and a typed detail pocket. The event
table also has a first-class `docketEntityId` and an entity-time index.

## Product model

### Context before personalization

The route determines scope:

- `/orgs/:orgId/stream` shows the workspace firehose. Membership is sufficient, matching current
  authorization.
- `/stream` shows the firehose across every workspace the viewer may access. Each episode names its
  workspace. It must query membership-scoped events, not the “concerns me” recipient projection.
- An entity-bound reuse shows events directly associated with that entity. Descendant aggregation is
  opt-in per containing surface; it is not inferred by the base Stream because “this project” and
  “everything below this project” are different scopes.

The same filters apply inside any scope. Filters narrow the timeline; they never redefine the
meaning of Stream as a personal queue.

### Timeline before grouping

Events remain ordered newest first by `(occurredAt, id)`. Date buckets—Today, Yesterday, Earlier
this week, Earlier—remain useful orientation.

Grouping is a presentation projection called an **episode**. An episode is a consecutive run of
events about the same canonical entity within the same date bucket and no more than two hours apart.
It does not pull older events above newer events about another entity. This preserves the truth of
the timeline while reducing fragmentation in common edit bursts.

The stable episode subject key is:

1. `organizationId + docketEntityId` when association has resolved;
2. otherwise `organizationId + source.system + entity.kind + entity.externalId`;
3. otherwise the individual event id, which makes an event without a subject stand alone.

An episode closes when the next event has a different subject key, crosses a date bucket, or is more
than two hours older than the preceding event. Loading another page recomputes the projection over
all loaded rows, so the last episode on one page may merge with the first episode on the next without
changing event order.

### Meaning before compression

Each episode contains three presentation levels:

1. **Subject header** — entity icon, title, type, and external source when the source is not Docket.
2. **Substantive event lines** — one visible line per meaningful change, in time order within the
   episode.
3. **Related activity disclosure** — one compact summary for minor or repeated events, expandable to
   the complete underlying event list.

The renderer classifies conservatively. An unknown event is substantive by default.

Always substantive:

- creation, completion, status, ownership or assignment changes;
- title, priority, start date, due date, project, program, initiative, cycle, team, or parent changes;
- comments, messages, mentions, inbound email, and review requests;
- calendar invitations and schedule changes;
- decisions, answers, blockers, failures, and agent outcomes;
- external events whose typed detail is not understood.

Eligible for the related-activity disclosure:

- exact repeated events;
- reactions;
- timer start, pause, resume, switch, and stop transitions;
- agent progress checkpoints that are not blockers or outcomes;
- field-change mutations limited to description, labels, links, or other cosmetic metadata.

Substantive means “never hidden,” not “must become a separate card.” Two substantive events about the
same subject may appear as separate lines inside one episode. If an episode contains only minor
events, Stream still renders one summary line such as “You made 4 small edits”; it never drops the
episode.

Exact duplicates use a presentation fingerprint of actor, kind, subject key, and normalized typed
detail inside a five-minute window. One line remains visible and the disclosure reports the repeats.
This is defensive display deduplication, not deletion: every original event remains accessible and
the canonical event log is unchanged.

## Information design

### Page frame

The header is compact:

- Title: `Stream`
- Workspace subtitle: `Everything that happened in {workspace}.`
- Hub subtitle: `Everything that happened across your workspaces.`
- A visible `Filters` control with an active-filter count. On the Hub, workspace is a first-class
  filter and each episode includes workspace attribution.

The fixed newest-first timeline removes group-by and arbitrary sort controls from the default
toolbar. Source, event type, person, entity type, workspace, and date remain available as filters.
Saved filters may remain behind the same filter surface, but they do not change episode semantics.

### Episode anatomy

Episodes are inline ledger groups separated by hairlines and whitespace, not elevated cards. The
entity—not an actor avatar—anchors the group because the entity is what binds the story together.

The subject header opens the canonical entity. An external-only subject opens its provider URL.
Individual event lines open the existing event drawer for exact time, complete typed detail, source,
and Athena context. The drawer keeps the raw record auditable while the timeline stays compact.

The source badge is omitted for native Docket events. External sources appear once in the subject
header unless events in the same episode genuinely mix sources. Workspace attribution appears only
when the current scope spans workspaces.

Each substantive line reads as `{actor} {verb} {change}`, without repeating the subject already named
above. Examples:

- `You completed the task` · `In progress → Done`
- `Maya moved the target date to Aug 12`
- `Athena resolved the blocker and resumed work`
- `Jordan requested your review` · `Google Drive`

Relative time sits at the line's trailing edge. Exact local date and time is available in the drawer
and via the timestamp's accessible label.

### Identity language

The API projection marks whether the resolved event actor is the current viewer in that workspace.
The renderer follows these rules:

1. The viewer is always `You`; Docket never prints the viewer's full name back to them in an event
   sentence or metadata.
2. Athena and registered agents use their product display names.
3. Other people use their stored display name. Docket does not split or guess a “first name” from a
   legal/display string. A future preferred-name field may provide a shorter label explicitly.
4. A known sender from typed external detail is named instead of `Someone`.
5. An unresolved actor is `Someone` only when the source provides no better identity.

Actor names appear once per event line and are not repeated in a metadata footer. Full profile and
source identity remain available in the drawer.

### Interactions

- Clicking the subject header opens the thing.
- Clicking an event line opens the exact-event drawer.
- `N related events` expands in place and preserves chronological order.
- Expanded related events use the same actor and timestamp rules but a quieter visual treatment.
- Athena actions live in the drawer or page-level context action, not as repeated hover controls on
  every line.
- Mark done and snooze do not belong to Stream; those are Triage semantics.

When polling discovers new events while the viewer is not at the top, Stream shows a `N new events`
control rather than moving the current reading position. Activating it inserts the events, scrolls to
the top, and announces the update to assistive technology. At the top, new episodes may insert
without a blocking prompt while preserving focus.

## Data and component design

### API projection

No new event table or episode table is required. Episodes are viewer-side presentation, not durable
domain objects.

`StreamEventOut` gains `actorIsViewer: boolean`. The organization route derives it by comparing the
event actor's `docketActorId` with `actorCtx.actorId`. The Hub route resolves the viewer's Actor ids in
their accessible workspaces and applies the same comparison. An unmapped external identity remains
`false`; the UI does not guess.

The Hub read changes from `event_recipient` to a membership-scoped `event` query. It keeps the same
keyset ordering and cursor safety. `relevance` may remain nullable in the DTO for compatible filters
and other consumers, but it is not primary Stream metadata.

Entity-bound reads use the existing indexed `event.docketEntityId`. If implemented as a query
parameter, it is an exact association filter; descendant expansion requires an explicitly resolved
set of permitted entity ids from the containing feature.

### Client projection

`toRow` retains actor identity and the new viewer relationship rather than flattening the actor to a
name alone. A pure `buildStreamEpisodes(rows, now)` function performs:

1. recency bucketing;
2. consecutive subject-key clustering;
3. conservative substantive/minor classification;
4. presentation duplicate folding;
5. episode summary derivation.

The projection returns stable episode ids from the first/newest event id. No state is stored inside
the grouping function, and no event is mutated or omitted from the episode's underlying event list.

`StreamView` renders semantic date sections and episode lists. `StreamEpisode` owns the subject
header and disclosure. `StreamEventLine` owns one event's sentence, typed detail, and timestamp.
`EventDrawer` remains the exact-event inspection surface.

The existing typed detail renderer gains explicit arms for `docket.field_change`, `docket.timer`, and
agent milestones. Field changes render their stored application-owned labels and before/after values;
they never expose database field names or provider exception text.

## Responsive, theme, and accessibility behavior

- Desktop measure stays bounded near the current `max-w-4xl`; extra width does not stretch event
  prose into unreadable lines.
- At narrow widths, the entity icon and content remain a two-column grid. Timestamps wrap beneath
  their line rather than forcing horizontal overflow. Filter controls collapse to one labeled
  button with a count.
- Episode groups use semantic headings and ordered lists. The related-activity disclosure is a real
  button with `aria-expanded` and an explicit count.
- Every subject and event line has a visible keyboard focus state and at least a 40px touch target on
  mobile.
- Color remains neutral except for earned event semantics. Meaning never depends on color alone.
- Loading skeletons match episode geometry in both themes. Reduced motion disables insertion and
  disclosure transitions without changing behavior.
- The implementation must pass the 320px horizontal-overflow check in both themes.

## States

- **Loading:** five episode-shaped skeletons with entity anchors and one to three event lines.
- **Empty context:** `No activity yet` plus an explanation that changes in this context will appear
  here. It does not suggest creating work unless the current context exposes that action.
- **No filter results:** `No events match these filters` with `Clear filters` as the action.
- **Error:** application-owned copy, retry, and no raw provider or exception text.
- **Long titles:** one-line subject truncation with the full title available on focus/hover and in the
  drawer.
- **Large episodes:** the substantive lines remain visible; related activity starts collapsed and may
  be expanded without a page jump.

## Validation

### Pure behavior tests

- Same-subject consecutive events within two hours form one episode.
- A different subject, date boundary, or gap greater than two hours starts a new episode.
- The projection never reorders events across subjects.
- Episodes merge correctly when another page is appended.
- Every substantive event remains visible.
- Minor-only episodes retain a readable summary.
- Exact display duplicates fold without removing underlying records.
- Unknown kinds/details default to substantive.
- Self actors render `You`; unmapped actors never render `You` by guesswork.

### Contract and route tests

- Workspace Stream marks `actorIsViewer` from `actorCtx.actorId`.
- Hub Stream includes every event from accessible workspaces and excludes inaccessible workspaces.
- Hub pagination remains stable over equal timestamps.
- Entity filters use exact authorized associations and do not leak cross-workspace entities.

### Component and visual tests

- Typed field changes show labels and before/after values.
- Docket source attribution is suppressed; external attribution appears once.
- Disclosure keyboard and screen-reader behavior is complete.
- New-event buffering preserves scroll and focus.
- Loading, empty, filtered-empty, error, overflow, light, dark, desktop, and 390px mobile states are
  screenshot-verified against the Docket Craft Rubric.

## Non-goals

- Stream does not rank events by personal importance or reproduce Triage.
- Stream does not create durable episode rows or rewrite canonical event history.
- Stream does not use model-generated summaries to decide what is substantive.
- Stream does not silently discard low-value activity.
- Stream does not infer preferred names by parsing display names.
- Stream does not automatically include all descendants of every container context.

## Rejected directions

- **One row per event:** accurate but too literal; it preserves storage shape instead of user
  meaning.
- **Persistent subject master/detail:** strong continuity but weak chronology and too much interface
  for a timeline.
- **Digest-first Stream:** useful after time away, but a synthesis is not a trustworthy live history.
  Digests may link into Stream without replacing it.
- **Personal relevance feed:** duplicates Triage and contradicts the workspace/context-wide model.
