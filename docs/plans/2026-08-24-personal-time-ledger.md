# Personal Time Ledger

This plan is for the Athena team. Implement the described review surface and verify that an
individual can inspect and correct their own recorded time before treating it as shipped.

The Time page is a private Hub destination. It defaults to Sessions for the current calendar week
in the Hub timezone. A single URL-backed selection controls Sessions, Breakdown, and Now. The URL
stores view, period, anchor, cycle, custom dates, measure, and the selected workspace, project,
task, category, and capture-source filters.

Sessions list actual records by local day. Breakdown groups exactly those records and returns a
person to Sessions with the selected bucket applied as a server-side filter. Now only points back
to Focus. The page must use named controls, keep the period controls and Add past time visible, and
move lower-priority controls into Filters without wrapping a control row.

The API applies every filter before it hydrates records, calculates totals, or builds buckets.
Cycle selection reads caller-visible periods, sets its exact range, and scopes to its workspace.
Day, week, month, and custom ranges use calendar boundaries in the Hub timezone. Custom input is
inclusive to the person and exclusive to the query.

Add past time creates a closed manual record. A person may correct a completed manual or
reconstructed interval by superseding it. A person may remove an unsubmitted manual record from
their visible history without hard deletion. Live, agent, submitted, and another caller's records
remain immutable or hidden. Split and merge operations remain deferred.

The implementation must cover the filtered API contract, cycle visibility, repair boundaries,
URL-state calendar arithmetic, Home navigation, Focus handoff, session browsing, breakdown
drilldown, and user-owned empty and error states. Run focused API and web tests, scoped lint, and
the package typechecks before release. Capture desktop and phone screenshots in both themes before
calling the visual review complete.

The [data-flow diagram](2026-08-24-personal-time-ledger-data-flow.mmd) shows the invariant: every
visible total and bucket originates from the same selected record set.
