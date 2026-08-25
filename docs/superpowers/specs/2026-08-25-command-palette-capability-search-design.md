# Command Palette Capability Search

This design is for the engineer who extends Docket's command palette. The engineer must add new
top-level destinations and stable Settings groups to the capability catalog when those surfaces
ship.

## Decision

Cmd+K will merge two search sources. The API will continue to search user and workspace data. A
frontend capability catalog will search application destinations, panels, actions, Settings
sections, nested Settings pages, groups, and subsections.

Feature modules will own plain capability descriptors. Views and Cmd+K will consume the same
descriptors, but views will not import palette code. The catalog will resolve descriptors against
the current user, route, workspace, workspace kind, vocabulary, and management permission before
matching them.

Runtime component registration was rejected because unmounted routes would remain invisible.
Putting application metadata in the Postgres search index was rejected because deployed UI is not
tenant data and does not need indexing jobs, migrations, or query-time data permissions.

## Result contract

Every capability has a stable ID, kind, label, plain-text description, aliases, icon, breadcrumb,
scope, availability rule, and declarative target. Targets identify routes or shell-owned intents.
They never capture React callbacks.

An empty query keeps the current grouped browse state. A typed query merges immediate catalog
matches with the debounced server response into one list of at most 20 results. Exact labels and
aliases rank first. Prefixes rank next, followed by whole-word metadata matches, description and
breadcrumb matches, and subsequence fallbacks. The server's score only orders server results that
otherwise tie.

The palette tracks its active row by result ID. A late server response may reorder results, but it
must not change what Enter activates. A failed server request leaves catalog results usable.

## Coverage boundary

The first catalog covers Home and workspace destinations, Agenda, Focus, Athena, existing global
actions, personal Settings, current-workspace Settings, stable nested Settings destinations, and
stable Settings groups and subsections. It excludes page toolbars and rows derived from user data.

Personal Settings remain available in both search scopes. Hub scope resolves workspace Settings
against the shell's current workspace instead of repeating the same result for every workspace.
Management-only and shared-workspace-only capabilities disappear before matching. Rail panels
disappear on Calendar and Settings routes because those routes do not host the rail.

## Settings links

Stable Settings groups and subsections use descriptor-derived anchors. A group result opens its
routed Settings page, waits for the content to mount, scrolls the heading into view, and moves
keyboard focus to that heading. Visible copy can change without breaking the anchor.

## Validation

Catalog tests will reject duplicate IDs, missing descriptions, invalid targets, incomplete shell
navigation coverage, and static Settings headings without descriptors. Search tests will cover
ranking, source merging, async selection stability, availability, failures, and empty-query
behavior. Browser evidence will cover desktop and phone widths in both themes.
