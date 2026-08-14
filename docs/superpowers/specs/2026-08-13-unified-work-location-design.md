# Unified Work Location Source Of Truth

> **Status**: Approved for implementation
> **Date**: 2026-08-13
> **Area**: Personal Hub, scheduling, Time Ledger, calendar providers, Agenda, Calendar

## Objective

Docket owns one user-scoped answer to two distinct questions:

1. **Current location** — the strongest fresh evidence of where the user is now.
2. **Expected location** — the explicit or conservatively inferred place for an instant or range.

The source of truth lives under the user's personal Hub and spans every workspace. Calendar
providers are projections of it, never the canonical store.

## Place Model

A person may have any number of regular named places. A saved place has a user-defined name,
optional geofence, stable ordering, and provider mappings. It has no `home | office | custom`
domain enum: those are provider classifications and cannot describe places such as a client site,
library, train, or a second office.

`Home` and `Office` may be offered as creation presets. Separately, the user's work-location
profile may designate at most one saved place as `homePlaceId`. This designation supplies a useful
default for providers with a home-office concept without changing the place's identity. Any number
of places may independently map to an office classification for a provider account.

Provider mappings are account-aware. A Google mapping retains its `homeOffice`, `officeLocation`,
or `customLocation` classification and optional building/floor/section/desk identifiers. A newly
created unmapped place projects to Google as `customLocation`; the designated home defaults to
`homeOffice`. Future providers own their own vocabulary.

## Expected Location

Explicit assertions are one-off full-day/timed intervals or weekly series with occurrence
exceptions. Weekly series carry selected weekdays, local full-day or start/end time, IANA
timezone, effective start, and optional inclusive end.

Expected resolution uses half-open intervals and the following precedence:

1. Explicit Docket or imported-provider assertion.
2. Active calendar/work block with a saved-place binding.
3. The gap between consecutive same-day work blocks when both name the same saved place.
4. Unknown.

Timed assertions beat all-day assertions. Explicit assertions beat derived evidence. A newer
explicit revision breaks equal-scope ties.

## Current Location

Current observations are separate, short-lived evidence rather than schedule mutations:

1. Unexpired manual override.
2. Fresh foreground-browser observation matched locally to a saved place.
3. Active Time Ledger work whose planning-context calendar item names a saved place.
4. Expected location, labeled `inferred_from_expected`.
5. Unknown.

The browser never sends raw observation coordinates. It matches a position locally and sends only
the saved-place id and reported accuracy. The server stamps receipt time and expires device
observations after fifteen minutes. A manual override defaults to the end of the Hub-local day.

## Provider Convergence

Every linked Google account with the required delegated Calendar grant receives an independent
primary-calendar working-location sync, even when its primary calendar is hidden from the layered
calendar. Direct Google edits update canonical assertions and fan out to the other supported
accounts. Provider delivery is retryable and eventually consistent; it never rolls back the
canonical write.

Bindings retain provider event/series/occurrence identity, ETag, remote update time, payload hash,
and last projected canonical revision. Matching notifications acknowledge Docket writes. Only a
genuinely newer remote edit is adopted. A remote deletion of a bound event deletes the canonical
assertion or exception and fans out.

Google daily recurrence normalizes to all seven weekdays; one-week `WEEKLY` recurrence imports
directly. Other recurrence patterns remain untouched and produce an `unsupported_recurrence`
action instead of a bounded approximation.

## Product Surfaces

Personal settings owns saved places, optional home designation, per-browser foreground detection,
provider mappings, and account sync health. Agenda and Calendar share one compact location-context
strip and editor for full-day, partial-day, and weekly schedules. Calendar items and scheduling
commitments may bind to saved places while retaining legacy free-form location text for display.

Provider `workingLocation` calendar rows remain available for compatibility, but stop rendering as
ordinary events after canonical bootstrap.

## Privacy And Scope

- Geofence coordinates exist only on an explicitly saved place and are returned only to its owner.
- Raw browser observations never enter requests, database rows, logs, or telemetry.
- Foreground web detection stops when the document is hidden; native background sensing is not V1.
- Current location is evidence, not an attendance, safety, or authorization guarantee.
- Microsoft Graph is represented by a tested provider capability contract, not a V1 connection.
