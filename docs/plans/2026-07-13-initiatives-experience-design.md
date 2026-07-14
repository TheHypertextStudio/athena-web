# Initiatives Experience Design

## Objective

Make Initiatives the strategic object in Docket: a concise executive portfolio on the outside and
a durable, document-like brief on the inside. Initiatives still contain no Tasks. Programs and
Projects remain associated work, while one workspace-defined hierarchy expresses how strategies
and objectives relate.

## Product contract

An Initiative has a manual lifecycle (`proposed`, `active`, `completed`, or `canceled`), an
independently writable health verdict, priority, owner, target, update cadence, labels, resources,
summary, and a freeform Markdown document. Health may be written directly by a person or Athena,
or supplied by an Initiative update. Connected-work health is a separate rollup and never replaces
the Initiative's own verdict.

Each workspace owns an Initiative hierarchy context. Its maximum depth is configurable from one to
five total levels and defaults to two: a root and one sub-Initiative level. Hierarchy edges are
references, not containment or access grants. An Initiative has at most one parent in a given
context but may appear in separate organization and personal contexts. Cross-workspace references
are visible only to a viewer who already has access to both workspaces; inaccessible nodes and
their rollups are omitted entirely.

## Overview

The overview keeps its top band deliberately slim: the page title, creation action, and one
horizontal "Needs your attention" surface with at most four items. Off-track and at-risk
Initiatives rank before active Initiatives whose latest update is overdue for their cadence. The
roster below is a dense hierarchy with status, health, owner, target, and update freshness rather
than decorative cards or aggregate vanity counts. Always-visible, rounded connector rails express
the hierarchy without adding a second disclosure control beside each Initiative's identity.

Every Initiative has a rounded Material icon inside a consistent circular field and 40-pixel
interactive target. Workspace contributors can search a broad, stable icon catalog and change the
semantic color from an anchored picker. This presentation metadata is stored in the generic
`entity_display` relation, not on the Initiative or Project domain record, so visual identity
remains an optional layer over strategic work rather than part of its business meaning. Projects
use the same display contract and receive a folder default; Initiative overview reads compose
display metadata server-side.

The full six-column roster retains a minimum readable width at every viewport and scrolls
horizontally inside its own quiet surface rather than collapsing metadata into a different mobile
information architecture. Rows use a consistent 72-pixel rhythm. Descriptions wrap to at most two
lines within a bounded measure; an Initiative without a description vertically centers its title
and icon instead of reserving an empty text line. Column and row content is inset from every edge,
and row hover tone replaces decorative separator lines.

## Detail

The detail page reads like a printable strategic brief. The latest update appears above the
permanent document, followed by sub-Initiatives and connected work. A narrow property rail holds
the Initiative's lifecycle, health, connected-work health, priority, owner, target, cadence,
labels, and URL resources. Overview and Updates are the only first-level tabs.

The Markdown document generates a minimal contents list from level-one through level-three
headings. It sits in the document gutter on wide screens, collapses above the document on narrow
screens, and updates immediately after edits. The initial templates are Blank, Strategic
Initiative, and Objective. The two guided templates use the neutral outline `Overview`,
`Motivation and Purpose`, `Desired Outcome`, and `Approach`; the resulting body is ordinary
Markdown with no parallel schema.

## Deliberate exclusions

This slice does not add structured Key Results, metric connectors, reactions, subscriptions,
reminders, or per-update comment threads. It does not turn Initiatives into Task containers, and a
cross-workspace hierarchy link never grants access to the referenced workspace.

## Acceptance

The implementation is complete when hierarchy depth and access isolation are enforced, inherited
work is deduplicated, attention ordering is deterministic, the document contents are accessible
and responsive, print output preserves the brief, vocabulary skins remain intact, and the root
typecheck, lint, test, and build gates pass.
