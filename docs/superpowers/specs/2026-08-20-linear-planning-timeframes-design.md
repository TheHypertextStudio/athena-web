# Linear-Compatible Planning Timeframes

> **Status**: Approved for implementation under A113 product-owner delegation
> **Date**: 2026-08-20
> **Audience**: Athena maintainers who will implement and verify planning timeframes
> **Area**: Projects, Initiatives, workspace settings, timelines, filters, exports, and Linear sync

## Decision

Athena will mirror Linear's planning-timeframe contract for Project start dates, Project target
dates, and Initiative target dates. Each field may hold a precise day or a month, quarter,
half-year, or year. Tasks, Milestones, Cycles, calendar events, and all other calendar-day fields
will remain precise.

The public contract will use Linear's names and values. A precise day has a null resolution. A
broad timeframe has one of `month`, `quarter`, `halfYear`, or `year`. Athena will not add a `day`
value or expose a separate range object. This keeps Athena's typed API and Linear integration
structurally compatible.

Athena will keep each existing date column as the canonical calendar anchor. A broad Project start
date stores the period's first day. A broad Project or Initiative target date stores the period's
last day. Linear's live GraphQL data uses the same boundary rule. Existing rows need no date
rewrite because a null resolution means the saved value is already a precise day.

## Linear Compatibility Boundary

Linear's public Projects documentation offers year, half-year, quarter, month, and precise-day
choices. Its GraphQL schema exposes nullable `startDateResolution` and `targetDateResolution`
fields with the four broad enum values. `Organization.fiscalYearStartMonth` uses a zero-based month
from `0` through `11`, where January is `0`.

Athena will expose these additions:

```typescript
export const DateResolution = z.enum(['month', 'quarter', 'halfYear', 'year']);

type ProjectOut = {
  startDate: string | null;
  startDateResolution: DateResolution | null;
  startDateFiscalYearStartMonth: number | null;
  targetDate: string | null;
  targetDateResolution: DateResolution | null;
  targetDateFiscalYearStartMonth: number | null;
};

type InitiativeOut = {
  targetDate: string | null;
  targetDateResolution: DateResolution | null;
  targetDateFiscalYearStartMonth: number | null;
};

type WorkspaceSettingsOut = {
  fiscalYearStartMonth: number;
};
```

The corresponding create and update contracts accept the same nullable resolution fields. They do
not accept the fiscal snapshot fields. Those fields are read-only Athena extensions because a
browser needs the saved basis to preserve a fiscal-quarter label after the workspace setting
changes. The workspace settings update contract accepts `fiscalYearStartMonth` as an integer from
`0` through `11`. A fresh workspace uses `0`.

Athena will not copy undocumented Linear behavior. Linear's public names, enum values, fiscal-month
numbering, and date boundaries define compatibility. Athena's private storage and validation may
be stricter when that prevents ambiguous data.

## Canonical Storage

The Project table gains nullable `start_date_resolution` and `target_date_resolution` columns. The
Initiative table gains nullable `target_date_resolution`. Each resolution column uses the four
public values.

Each broad field also gains a private nullable fiscal snapshot:

- `project.start_date_fiscal_year_start_month`
- `project.target_date_fiscal_year_start_month`
- `initiative.target_date_fiscal_year_start_month`

The Organization table gains `fiscal_year_start_month` with a default of `0` and a check constraint
from `0` through `11`.

The fiscal snapshot records the workspace setting that defined a saved broad timeframe. The server
sets it during a broad-date mutation. Write clients cannot supply it. Read contracts return it so
every Athena surface can derive the saved label and grouping key without consulting mutable
workspace policy. A later workspace setting change affects new selections only. Existing anchors,
labels, filtering keys, and snapshots do not move. This rule prevents a saved `Q2 2027` from
becoming a different calendar range after an administrator changes the fiscal year.

The database enforces these invariants:

- A null date requires a null resolution and a null fiscal snapshot.
- A precise date has a null resolution and a null fiscal snapshot.
- A broad date has a non-null resolution and a fiscal snapshot from `0` through `11`.
- A broad Project start anchor is the first day of its period.
- A broad Project or Initiative target anchor is the final day of its period.
- A Project start anchor cannot follow its target anchor.

The migration adds nullable metadata and leaves every existing date unchanged. Existing values
therefore remain precise dates. The migration adds the organization default before the application
starts accepting broad values.

## Mutation Rules

The API interprets field pairs atomically. A date with an omitted or null resolution saves a
precise day and clears any old fiscal snapshot. A null date clears its resolution and snapshot. A
broad resolution requires a date in the same request. The API rejects a resolution without a date.

The date must already equal the canonical boundary for the requested resolution. The API returns
an application-owned validation error when the boundary is wrong. It does not silently move a
client's date because silent correction hides integration bugs. The server computes and stores the
fiscal snapshot from the workspace. It does not trust client fiscal data.

Old clients remain compatible. They send only the date. Athena treats that input as a precise day.
New clients send both fields when they choose a broad timeframe. The response always returns the
resolution field, including null.

Date-only strings remain calendar dates. Domain code must not pass these values through local-time
`Date` construction. A shared pure helper will parse and calculate Gregorian calendar components
so that a timezone cannot move a boundary.

## Shared Timeframe Domain

One shared module will own the calendar rules. The module will export the documented
`DateResolution` type and pure helpers for these operations:

- resolve a year, half-year, quarter, or month selection into start and end calendar dates;
- choose the correct start or target anchor;
- validate that a stored anchor matches its resolution and fiscal snapshot;
- format a saved value for people;
- return a stable grouping key and label;
- test whether a saved timeframe overlaps a filter range.

Fiscal quarters, half-years, and years use the saved zero-based fiscal start month. Fiscal years are
named for the calendar year in which they end. A workspace that starts its fiscal year in July
therefore shows July 2026 through June 2027 as `FY 2027`. Quarters and halves include that fiscal
year when a calendar-year-only label would be ambiguous. A January workspace can use Linear's
short labels such as `Q2 2027`, `H1 2027`, and `2027`.

Month labels use the calendar month and year because fiscal alignment does not change a month.
Precise dates use the existing localized calendar-date formatter.

The data-flow diagram records how workspace policy becomes stable saved metadata and then feeds
every reader: [planning timeframe data flow](./2026-08-20-linear-planning-timeframes-data-flow.mmd).

## Picker Behavior

The UI package will add `TimeframePicker` and `TimeframeRangePicker`. They will compose the existing
calendar grid for precise dates instead of changing `DatePicker` or `DateRangePicker`. This keeps
the exact-day contract stable for Tasks, Milestones, Cycles, and the other audited date surfaces.

The first picker view shows Linear's five choices: year, half-year, quarter, month, and specific
date. Each broad row shows nearby choices around the current period and supports previous and next
navigation. `Specific date` opens the existing month grid. A selection commits once, closes the
popover, and returns the canonical anchor plus nullable resolution. `Clear` removes both.

The trigger shows the semantic value rather than its hidden anchor. A June target saved as
`2026-06-30` displays `June 2026`. A quarter target displays `Q3 2026` or its fiscal equivalent. A
precise target continues to display the formatted day.

Project create and detail surfaces use a `TimeframeRangePicker` for start and target. Initiative
create and detail surfaces use one `TimeframePicker` for the target. The range picker compares the
canonical anchors and prevents a start that follows the target. It does not require matching
resolutions.

The picker preserves the existing keyboard and popover contract. Arrow keys move choices. Enter
selects. Escape and an outside click close without saving. Focus returns to the trigger. All
choices expose their semantic labels to assistive technology. The popover must fit at 320 pixels
without horizontal scrolling.

## Reading And Presentation

Project and Initiative timelines continue to use canonical start and target anchors. Broad starts
therefore begin at the first day of their period. Broad targets end at the final day. No timeline
geometry needs a second interval representation.

Text surfaces must use the shared semantic formatter. They must not expose the anchor as if the
person chose that precise day. Search documents, activity copy, Athena summaries, exports, and MCP
representations must carry or format the resolution when they handle these fields.

Filtering and grouping operate on the saved timeframe. A timeframe filter matches the semantic
period key, which contains its canonical boundary, resolution, and fiscal snapshot. Timeframe
grouping uses the same key and shared label. It does not group a June timeframe under June 30
merely because that is its target anchor. Chronological ordering still uses the canonical anchor.

CSV and workspace takeout exports add resolution columns beside the existing date columns. Linear
import and sync pass `startDateResolution` and `targetDateResolution` through when the remote object
supports them. The connector also reads Linear's organization fiscal start month and stores that as
the imported value's fiscal snapshot. Imports without resolution remain precise.

## Workspace Setting

The Work structure settings page gains a `Fiscal year starts` month selector. It explains that the
choice controls new Project and Initiative quarters, halves, and years. Saving the setting does not
rewrite existing work. The setting uses the typed settings query and mutation that already own
work-structure configuration.

The selector is available to the same roles that can change the other workspace work-structure
settings. The API applies the existing authorization policy. It returns application-owned error
copy for invalid values or failed saves.

## Error And Compatibility Policy

The web app must never render raw API or database text. It maps invalid timeframe pairs, invalid
fiscal months, and reversed Project ranges to stable application-owned messages.

Readers must tolerate a legacy or inconsistent row by displaying its anchor as a precise day and
recording an internal diagnostic. They must not crash a whole Project or Initiative surface. Writes
remain strict so that no new inconsistent row enters the database.

The typed API change is additive. The database change is additive. Exact-date callers need no
payload change. Linear mappings can copy matching field names without translation.

## Verification

Pure calendar tests cover leap years, month ends, every fiscal start month from `0` through `11`,
all four resolutions, both start and target anchors, fiscal labels, and setting changes that leave
existing periods unchanged.

Schema and API tests cover migration defaults, constraints, create and update pairs, exact-date
backward compatibility, clear behavior, invalid boundaries, unauthorized settings changes, and
serialization of null and broad resolutions.

Picker tests cover all five choices, keyboard navigation, clear, cancellation, range ordering, and
semantic trigger labels. Inventory tests prove that only Project and Initiative planning fields use
the new picker. Timeline, filter, grouping, export, MCP, and Linear integration tests prove that
each reader preserves the saved meaning.

The final design review captures Project and Initiative create and detail surfaces at 1440 by 900
and 390 by 844 in light and dark themes. It also checks the picker at 320 pixels, keyboard focus,
screen-reader labels, and period-boundary copy.

## Rejected Alternatives

An explicit start and end range for every planning field would duplicate the existing anchor and
create invalid combinations. Linear does not use that public model. Athena will not introduce it.

A persisted expression such as `next quarter` would change meaning with time. It would also make
sorting, export, and integration behavior unstable. A quick action may resolve `next quarter` at
selection time, but Athena will persist the resulting fixed period.

Recomputing all saved quarters after a workspace fiscal-calendar change would alter existing plans
without an edit to those plans. Athena will preserve the saved fiscal basis instead.

## Non-Goals

- Broad due dates for Tasks or Milestones.
- Broad boundaries for Cycles or calendar events.
- Relative timeframes that move as the current date changes.
- Timezone-bearing instants or partial-day ranges.
- A general replacement for Athena's existing exact-day picker.

## Sources

- [Linear Projects](https://linear.app/docs/projects)
- [Linear project timeframes changelog](https://linear.app/changelog/2024-01-17-project-timeframes)
- [Linear GraphQL API](https://linear.app/developers/graphql)
