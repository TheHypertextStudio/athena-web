# Program Cards with activity pulse

**Reader:** The Athena maintainer implementing Program Cards. **Action:** Keep Cards as one
optional presentation, then add a bounded, access-safe activity pulse without changing the List,
Board, Timeline, saved-view, or Program-detail contracts.

## Decision

Program Cards will read like a calm portfolio gallery. Each card will show the fixed Program glyph,
Program name, a clamped summary when one exists, and the shared Initiative/Program health dot and
label. The card omits lifecycle status because Health and recent activity answer the gallery use
case. The card will not repeat that it is a Program, show owner/property rows, or show a
project/task count as though cardinality were a useful status.

The lower edge will show an eight-week activity pulse. Each neutral bar represents real visible
work activity in one calendar week. A user can scan which areas are active or quiet, then open a
Program to manage it. Health stays separate: it answers whether the area is okay, while the pulse
answers whether anything has moved recently. The pulse does not use health colors.

## Data contract

`ProgramViewRow` will gain a small, fixed-size activity summary. It will contain eight ordered
weekly buckets and the time of the newest included event. The query will aggregate only activity
the current viewer can already see through the Program's own work-view scope. It must not infer
activity from `updatedAt`, a record count, or a synthetic timestamp.

The event set will include Program updates and visible work activity from its attached Projects and
Tasks. The implementation will define that set next to the work-view query rather than guessing in
the renderer. A week with zero events remains a zero-height/quiet bar. A Program with no activity
shows the same pulse at zero and the plain-language recency copy `No recent activity`.

## Card structure

```
fixed glyph  Program name
             one-line summary when available

             health dot + label
             eight-week neutral activity pulse   Active this week / No recent activity
```

The whole card remains one keyboard-operable link to the Program. The pulse exposes an accessible
summary and week-specific labels through the existing shared tooltip/focus treatment. Long titles
truncate, missing summaries collapse, and neither condition leaves a placeholder row.

## Rejected directions

The generic `WorkCards` property dump is wrong because it presents storage fields rather than a
reason to open the Program. The previous proposal for a large amber `!` field is wrong because it
makes health look like an incident alert. A project constellation is also wrong for this slice: the
current view does not return real linked-project previews, and drawing a diagram from a count would
misrepresent the data.

## Risks and verification

The aggregation must remain bounded to one query response and must not introduce per-card
requests. It must preserve the existing visibility boundary for associated Projects and Tasks.
Tests will prove the schema, zero/recent activity copy, eight-bucket order, and that only the
Program Cards renderer changes. Visual review will cover the Cards lens at desktop and narrow
widths in both themes, including long names, an empty summary, a quiet Program, and all three
health states.
