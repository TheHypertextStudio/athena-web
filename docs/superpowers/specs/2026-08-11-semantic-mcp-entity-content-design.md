# Semantic MCP entity content design

## Objective

Make every Docket MCP App useful at a glance. A widget must communicate the entity's purpose,
current story, and useful next destination — not recite whichever columns happen to be hydrated.

## Design principles

1. **Meaning before metadata.** Title, outcome, prose, current work, and latest update take visual
   precedence over dates, IDs, and status keys.
2. **Composition belongs to the entity.** A project is a briefing, an update is writing, a session
   is a live account of work. Shared code supplies visual primitives and interaction behavior, not
   one universal fact-row layout.
3. **Show real relationships or nothing.** A section such as "Active work" only appears with
   actual linked items the reader can inspect. Counts can support a real list; they never replace
   one.
4. **Responsive means recomposed.** Small cards intentionally change information order and action
   placement. They do not merely shrink, wrap, or stack a desktop row.
5. **Details answer a question.** Secondary metadata appears only when it helps interpret the
   primary content or make a decision.

## Shared visual primitives

The widget runtime will provide a consistent card frame, typography tokens, focus behavior, and
responsive layout primitives:

- **Entity header:** an emphasized title, a one-line semantic context strip, and an optional
  summary/outcome. It establishes the card's subject before any attributes appear.
- **Narrative block:** prose such as a project outcome, update, comment, or agent guidance. It is
  readable content, not a muted property value.
- **Content section:** a labelled, spaced group of real related items, each with a useful second
  line or status and its own Docket action where the item is navigable.
- **Supporting facts:** a short, purpose-specific set of dates, health, policy, or state. These
  use an aligned definition layout on roomy cards and an intentional compact layout on narrow
  cards.
- **Batch list:** title, meaningful current context, and per-item action in a grid at wide sizes;
  title, context, then a full-width action at narrow sizes. It is never a nested scroll region.

Sections receive their own vertical rhythm. Tinted row backgrounds are reserved for scanable list
items, not used as a substitute for hierarchy.

## Entity compositions

| Entity           | Leads with                                  | Useful body                                                 | Supporting context                                  |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| Project          | Name and outcome/description                | Milestones, active tasks, linked initiatives, latest update | Health, status, target date, task count             |
| Program          | Name and outcome                            | Constituent projects and initiatives, latest update         | Health and rollup                                   |
| Initiative       | Name and outcome                            | Linked programs and projects                                | Health and target date                              |
| Task             | Title and current state                     | Description, blockers, subtasks                             | Priority and due date; state/due controls only here |
| Cycle            | Name and date window                        | Current cycle work                                          | Status                                              |
| Team             | Name and remit                              | Members and workflow                                        | Triage capability                                   |
| Update / Comment | The authored writing                        | Subject and author context when human-readable              | Publication/edit time                               |
| Session          | What the agent is doing and latest activity | Recent activity preview                                     | Status, trigger, elapsed or start time              |
| Agent            | Name and guidance                           | Approval policy and connection capability                   | Accountable owner when human-readable               |
| Saved view       | Name and what it surfaces                   | Readable filter/grouping summary                            | Scope                                               |
| Organization     | Name and purpose                            | Useful current rollup or recent planning work               | Counts only as supporting context                   |

When a DTO cannot supply the entity's primary content, the server contract must be enriched from
existing records before the widget renders a placeholder section. Opaque IDs must not become
visible fallback copy.

## Responsive behavior

- **Wide (over 560px):** detail facts align in a stable label/value grid; batch items use title,
  context, and right-aligned action columns.
- **Compact (381–560px):** preserve title prominence; move secondary context beneath the title;
  keep actions aligned at the item edge where space permits.
- **Narrow (320–380px):** each batch item becomes title, context, action; actions are full-width
  and at least 40px high. Detail facts use a two-line definition layout. Section headings and
  content remain separated by deliberate margins.
- Long prose clamps only in batches and exposes its full text through a title/accessible label;
  singleton cards keep readable prose. No layout may create horizontal overflow.

## Data and behavior

The server remains the sole source of entity links. Hydrators may add compact, human-readable
relationship previews and summaries from existing data; no migration is required. Widgets do not
manufacture routes, substitute IDs for names, or infer missing relationships from count fields.

## Validation

- Unit and MCP tests prove each enriched DTO remains authorized, ordered, and linked by the
  server.
- Fixtures cover content-rich and sparse variants for every entity type. Assertions prove that a
  relationship heading has real children and that task-only controls do not leak to other cards.
- Browser evidence covers 720px, 480px, and 320px in light/dark palettes, keyboard focus,
  action routes, and horizontal-overflow checks.
- The design audit is revised only after screenshots demonstrate the semantic compositions at
  those widths.
