# Standard Object Surfaces Design

## Objective

An initiative, project, program, task, cycle, or team must retain the same identity and interaction
contract wherever it appears. Lists, relationship collections, search results, and detail pages may
compose different supporting information, but they must not invent different object behavior.

The immediate product proof is Initiative hierarchy: a person can change a parent without relying
on drag, can still drag from the body of an Initiative row without a visible handle, and encounters
the same Initiative actions from every Initiative surface.

## Object Contract

Every rendered core object has one `ObjectRef` and one higher-order surface binding. The binding:

- stamps the global `data-object-*` identity used by right-click actions;
- makes the non-interactive body draggable when the object descriptor permits it;
- preserves nested links, buttons, and text selection as their own interactions;
- uses grab and grabbing cursor feedback without permanently visible drag affordances; and
- provides the same action registry object regardless of the surrounding container.

Containers own layout only. They do not redefine what an Initiative or Project can do.

## Standard Row

Relationship collections use the same object-row composition as overview lists: a 40px identity
target, a primary title, optional useful secondary context, and trailing state when it helps make a
decision. Rows are navigable, right-clickable, and draggable through the shared object surface.
There is no bespoke card for sub-initiatives or connected work and no decorative collection count.

The 40px target is the standard identity size in expanded and compact detail headers. The glyph
inside may remain visually lighter, but the target and its spatial weight do not shrink on scroll.

## Initiative Hierarchy

Hierarchy changes are one domain operation with two presentations:

1. `Change parent` opens a searchable Initiative picker and moves the Initiative beneath the
   selected parent.
2. `Move to top level` removes the existing parent edge.
3. `Add sub-initiative` opens the same picker in child mode and moves the selected Initiative
   beneath the current one.
4. Dropping one Initiative on another calls the same hierarchy mutation path as the picker.

The picker excludes the current Initiative and invalid choices. The API remains authoritative for
cycle prevention, permissions, workspace boundaries, and configured maximum depth. Failures use
application-owned copy.

## Initiative Detail Information Architecture

The detail tabs are `Overview`, `Sub-initiatives`, `Connected work`, `Updates`, and `Resources`.
Tabs do not show counts. Overview is the Initiative document and properties; the two relationship
tabs are collections of first-class objects rather than sections appended beneath the document.

The detail overflow and right-click menu dispatch through the Initiative action domain. The parent
relationship is editable from the detail surface, so hierarchy editing does not depend on drag.

## Shared Detail Header

`EntityDetailLayout` continues to own the compact header for every entity. At the compact endpoint:

- the identity target remains 40px rather than scaling to 24px;
- the title reserves enough inline space for that target;
- collapsed subtitle and metadata do not leave two grid gaps behind; and
- the tabs sit directly beneath the compact identity with one deliberate small gap.

These rules apply centrally, not route by route.

## Athena Entry Points

Visible per-object `Open Athena` or `Have Athena handle this` buttons are removed from overview and
detail page chrome. Athena remains available through its global surface and contextual action
system; object pages do not repeat a button whose destination is already persistent.

## Validation

Behavioral tests cover whole-row drag payloads, object identity stamping, nested interactive
controls, Initiative hierarchy mutation plans, count-free relationship tabs, and compact header
geometry. Focused unit/component tests, web type checking and linting, and a real browser capture of
the expanded and compact detail states form the ship gate.
