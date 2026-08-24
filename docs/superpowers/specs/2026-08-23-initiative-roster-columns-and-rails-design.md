# Initiative roster columns and rails

This design is for the engineer correcting the Initiatives roster. The finished change must remove
Active Project count from the work-view capability, fit Health into less horizontal space, and stop
each hierarchy connector at the end of its own subtree.

## Decision

Remove `activeProjectCount` from the Initiative work-view contract and response row. The API will
stop calculating, filtering, sorting, and projecting the value. Initiative-to-Project relations and
the Initiative domain APIs remain unchanged.

Use a 96px Health column in the shared work-list renderer. This width fits the longest current label,
`Off track`, including its dot and cell padding.

Derive continuation rails only for ancestors above the immediate parent. The row renderer already
draws the immediate-parent segment and shortens it when the current Initiative is the last sibling.
The existing derivation includes the parent a second time, so a full-height segment overwrites that
stop point and reaches the next root.

## Stored-view compatibility

A data migration will repair every stored Initiative definition. It will remove
`activeProjectCount` from displayed properties and sort terms. It will remove matching predicates
recursively from filters, collapse one-child groups, and replace an empty filter with `null`. It will
apply the same presentation and sort repair to personal view overrides in Hub preferences.

The migration preserves every unrelated view setting. Rejecting or resetting affected views would
discard user configuration for a field removal that the application can repair deterministically.

## Validation

Contract tests will reject the removed field in properties, filters, and sorting. API tests will
prove that the response and SQL registries no longer expose or calculate it. A migration test will
exercise saved views, workspace defaults, and personal overrides with nested filters. Rail tests
will cover multiple roots, last children, nested branches, and single-child chains. A browser check
will verify the corrected roster at desktop and narrow widths in light and dark themes.
