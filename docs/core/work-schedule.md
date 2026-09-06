# Work schedule

This specification is for product, API, and web engineers who change Docket's work-location
behavior. Those engineers must preserve one owner-defined default for when and where a person works.
They must keep provider data and current-location evidence at the boundaries described below.

## Decision

Docket owns the canonical work schedule. A connected calendar exchanges working-location changes
with Docket, but it does not own the schedule. A saved place has a stable Docket identity. A provider
label is only an account-scoped alias for that identity.

The personal settings interface has three owners. `Work schedule` owns defaults and dated changes.
`Places` owns saved places, provider aliases, map positions, and automatic location. `Connected
accounts` owns grants, connection health, and recovery actions. The interface does not group these
jobs under a generic calendar-sync destination.

The component diagram in [work-schedule.mmd](work-schedule.mmd) records these ownership boundaries.
The approved interaction details and rejected alternatives are in the
[work-schedule and places design](../superpowers/specs/2026-09-05-work-schedule-and-places-design.md).

## Default model

A schedule uses immutable effective-dated plan versions. Each version has an effective civil date,
a separate cycle-anchor civil date, an IANA timezone, and a repeating cycle from 1 through 28 days.
The effective date decides when the version starts. The anchor decides which cycle day applies, so
a person can change next Tuesday's hours without restarting a fourteen-day rotation. Each cycle day
has zero or more ordered work segments. A segment has a local start minute, a duration from 1 minute
through 7 days, and one location state: a saved place, mobile work, or undecided. An empty day means
that the person does not normally work that day.

A dated change replaces the entire generated day. It can contain several segments or no segments.
The empty replacement is how a person records a day off. Docket never merges a dated replacement
with generated segments because a partial merge can leave work that the person meant to remove.

Changing a default creates a new plan version from the chosen effective date. Docket closes the
preceding version on the prior date. Docket does not move historical intervals when the person
changes a timezone or rotation.

## Settings behavior

The default-schedule editor exposes the cycle length, effective date, anchor date, timezone, and one
nested editor for each cycle day. A day can hold split shifts and overnight segments. The saved view
groups cycle days with identical segments so a weekly Monday-through-Friday pattern scans as one
row. It keeps past dated changes behind a history disclosure while future changes remain visible.

`Places` never disables automatic location without an explanation. Before any saved place has map
coordinates, it shows a setup action and names the missing prerequisite. Once at least one place can
be matched, it shows a switch. Opting in starts one authenticated-app provider, so the foreground
watcher remains active after the person leaves Settings. Opting out prevents the browser from
requesting location.

## Resolution

The expected-location resolver expands the applicable plan version and then applies a dated
replacement. A saved-place segment returns that place. A mobile or undecided segment returns an
explicit work state without inventing a place. An explicit no-work date blocks fallback to old
weekly assertion data.

Legacy assertions remain a compatibility fallback only when no canonical plan answers the instant.
On the first schedule read, Docket converts compatible weekly and one-off assertions into one plan.
Docket archives the converted rows with their source plan id so history stays readable. Docket
leaves incompatible rows active and creates one incoming change instead of guessing through mixed
timezones, ranges, orphaned exceptions, or overlapping segments.

Current location remains separate evidence. A manual override or fresh foreground observation can
answer where the person is now. It never edits the person's default schedule. The browser matches
coordinates locally and sends only the matched place id and accuracy.

## Provider reconciliation

Docket projects the active schedule to each capable connected account. A seven-day plan can use a
weekly recurrence. A longer rotation uses a rolling 90-day window that the sync sweep refreshes.
Generated assertions carry stable plan-version and civil-date keys so retries remain idempotent.

Inbound provider labels resolve through aliases scoped to one connected account. Docket normalizes
punctuation and spacing for lookup. Docket does not create a place from an unknown label. It creates
one unmatched-name change that the person can resolve by linking a saved place or ignoring the
label. The decision becomes the alias used by later events from that account.

A recognized provider edit replaces the dated schedule unless the same date changed in Docket after
the version observed by the provider. That collision creates one schedule conflict. The person can
keep Docket's date or use the connected-account date. Every queued entry uses `Resolve` as its entry
action, and the detail view names the concrete decision.

## Limits

The schedule does not model an active shift with no known end. A segment can span at most seven days.
Cycle days use ordinal and weekday labels rather than custom crew names. Microsoft remains a tested
capability contract rather than a connected provider.
