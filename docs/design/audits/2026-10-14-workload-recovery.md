# Daily workload recovery acceptance

The read-only workload resource was recovered against the current embedded-app runtime. A local
sandboxed host renders the actual MCP resource and persisted test-account responses. It exercises
ten viewport/theme combinations: desktop, wide desktop, phone, short phone, and 320px, in light and
dark. Private captures and the verifier's result record retain the evidence.

The host verifies grouping and filtering without changing headline totals, zero and overloaded
capacity, timezone/date navigation, loading and empty states, failed refresh with retained content,
retry, keyboard focus, rapid navigation, and stale-response rejection. Accessibility scans report
no WCAG violations for the populated frames; expanded controls and tables pass horizontal overflow
checks. Coarse-pointer controls meet the 40px floor, and 200% text passes overflow. Captures wait for
the host to apply the collapsed frame's size notification before inspection.

Fresh review found two calculation defects in the retained implementation. Date-only assignment
dates now use their calendar representation rather than zoned instant bounds. Accepted plans now
use canonical allocations across every session, with legacy timeboxes as fallback. Regressions
cover split/shared sessions and private accepted work. The additional relative-navigation finding
is corrected by following the last requested date.

The executor also corrected an outdated app-document signature and gave the workload canvas an
explicit host-palette background. Both problems were reproduced by the actual-resource verifier.
Tool guidance was shortened to preserve the existing local-model prompt budget.

| Dimension           | Score | Evidence                                                                          |
| ------------------- | ----- | --------------------------------------------------------------------------------- |
| Brand and voice     | 3     | Scope, capacity assumptions, and unknown effort remain explicit.                  |
| Typography          | 3     | Shared host type and tabular metrics distinguish totals and explanations.         |
| Spatial rhythm      | 3     | Two-column phone totals and reflowing controls retain readable spacing.           |
| Hierarchy           | 3     | Full-day totals precede the filterable breakdown and optional details.            |
| Color               | 3     | Both themes use host semantic tokens and pass populated-frame contrast scans.     |
| Motion and feedback | 3     | Loading, retry, retained content, and request ordering are exercised.             |
| States              | 3     | Empty, loading, failed, zero-budget, overload, and unknown estimates are covered. |
| Detail craft        | 3     | Keyboard focus, coarse targets, text enlargement, and settled frame sizing pass.  |

This establishes local resource and protocol acceptance. It does not establish availability in a
production connector, a specific real host, or comprehensive screen-reader acceptance.
