# Coverless Detail Header Collapse Design

## Objective

Every core entity detail page keeps a collapsing header. Covered and coverless pages may have
different expanded compositions, but both must continuously resize the title and finish in the
same compact pinned header. A short document must never leave subtitle or metadata clipped at an
intermediate opacity or leave a blank masthead gap.

## Current Failure

`EntityDetailLayout` binds its collapse to the nearest scroll container and animates the secondary
row from its full height to zero. That row contributes to the scroll container's height. On short
coverless documents, shrinking it reduces the maximum scroll offset before the six-rem animation
range completes. The browser then clamps the scroll position and strands the header midway through
its own animation.

The universal collapse is intentional. The defect is the unstable progress geometry and the lack
of a deliberate coverless expanded state.

## Interaction Design

The shared header has three conceptual layers:

1. A sticky core containing actions, identity, and tabs.
2. An expanded layer containing the optional cover treatment, subtitle, and metadata.
3. A flow-owned collapse runway that scrolls away without changing size.

At the top of the page, the glyph occupies its own row above the title, and the title uses the
expanded headline token and may wrap. As the runway is consumed, the title continuously
interpolates to the compact title token, the glyph scales down and moves beside the title,
secondary context fades and clears, and the tabs rise into their pinned position. Once the runway
is consumed, the header remains fully compact with glyph and title inline. The compact title is a
single truncated line.

Covered headers retain a larger expanded composition and collapse distance. Coverless headers
start denser and use a shorter runway sized for their secondary context. Both variants resolve to
the same compact core.

## Architecture

The behavior remains centralized in `EntityDetailLayout`. Entity routes do not opt into collapse or
provide per-type tuning. The presence of `cover` selects one of two shared expanded geometries and
sets the corresponding CSS custom properties.

The existing CSS scroll timeline remains the progress source. Its range is backed by stable flow
geometry rather than the height of elements being collapsed, eliminating the feedback loop without
adding scroll listeners or render-per-frame state. Browsers without scroll-timeline support retain
a readable expanded header.

For people who request reduced motion, secondary context scrolls away without interpolation and the
sticky core uses compact typography. The reduced-motion path must not expose a partially faded or
partially clipped state.

## Scope

This change owns the shared detail-header structure, collapse styles, focused behavioral tests, and
the existing entity-detail hierarchy reference where it has drifted. It does not redesign document
cards, tabs, the Contents disclosure, or route-specific metadata.

## Validation

Behavior-focused coverage will prove that:

- Covered and coverless headers both reach the same fully compact state.
- A short coverless document cannot strand the header midway.
- The title size decreases continuously and reaches the compact design token.
- The glyph begins on its own expanded row and finishes inline with the compact title.
- Secondary context is fully visible at the top and fully absent after collapse.
- Tabs and document content do not jump or leave empty space.
- Long titles wrap while expanded and truncate when compact.
- Reduced-motion behavior remains readable and stable.

The final implementation will be checked with focused automated tests, type checking and linting for
the affected workspaces, and one explicitly serial browser-level check of covered and coverless
geometry. Validation must not start watchers, parallel worker pools, or browser MCP processes.
