# Projects Experience Design

## Objective

Make Projects the operating surface for managing more than one hundred bounded efforts without
losing the ability to understand one project deeply. The experience uses the Initiative views'
page shell, typography, responsive structure, display icons, query conventions, and property
editing patterns while preserving the different questions a Project must answer: what is moving,
what is blocked, what finishes when, and what needs action now.

## Overview

The organization Projects page has one strong title and a New Project action. It does not show
decorative aggregate totals or an abstract Portfolio overline. When Docket has a concrete action,
one restrained attention surface names the affected Project, the consequence, and the next action.

The roster supports three equal lenses over the same filtered Project set:

- **List** is the default high-density operating view. Rows use the same container, responsive
  horizontal scrolling, rounded Material display icons, title/description rhythm, and property
  alignment as Initiatives. Descriptions clamp at two lines and every row has a stable height.
- **Dependencies** renders the Project dependency graph as a native lens, with selection opening a
  lightweight inspector and the Project detail route. It is not a detached utility page.
- **Timeline** renders the same Projects as dated bars. Grouping, sorting, filters, visible
  properties, and saved view state remain available rather than being hard-coded to workspace.

The view settings are shared across lenses. List uses sorting and grouping directly; Timeline uses
the chosen group for lanes and sort for lane order; Dependencies uses the filtered Project set and
chosen grouping as visual context. Medium viewports keep the full table inside a local horizontal
scroller rather than replacing columns with lossy inline metadata.

## Detail

Project detail follows the Initiative detail page's document-like shell and spacing, but remains
operational rather than strategic. The header contains the Project display icon, editable title,
freeform summary, and one unified participant set derived from the accountable actor and actors
already working on Project tasks. It never labels people as lead versus contributors in the
presentation.

Only the immediately decision-relevant properties appear beside the participant set: health and
target date. Status, priority, progress, Program, Initiative associations, and Labels are available
through an anchored Project info disclosure and the editable property rail. This keeps information
one click away without dumping every property into the header or burying it after the document.

The tabs are:

- **Overview**: latest update, permanent Markdown Project document with generated contents, weighted
  progress, milestones, active agents, activity, and Project dependencies.
- **Tasks**: dependency map and milestone-grouped tasks.
- **Updates**: narrative updates and health-bearing updates.
- **Resources**: all URL resources attached to the Project, with add/remove actions.

There is no Print action and no redundant Projects back row. The owning workspace and Program form
the breadcrumb context. Resources are not shown in the Overview flow. On compact widths the primary
content always precedes the secondary property/dependency rail.

## Domain behavior

- A Project may associate with multiple Initiatives. Reads return every association and mutations
  add/remove individual links without replacing unrelated links.
- Project Labels reuse organization-global Labels through a dedicated join. Team-scoped Labels are
  excluded from the Project picker.
- Project Resources reuse the general attachment model and support URL resources in this slice.
- Project display icon/color remains in `entity_display`, separate from the Project record.
- The visible participant set is derived from existing work relationships. No Project membership
  count or new Project-member schema is introduced.
- Existing Project status, health, weighted progress, dates, Program, milestones, updates, tasks,
  agents, activity, and dependencies remain authoritative.

## Accessibility and responsive behavior

- Every icon-only control keeps a 40px interactive target and uses rounded Material icons.
- Tabs preserve roving keyboard focus and horizontal scrolling.
- View settings and Project info use anchored, keyboard-operable popovers.
- Graph nodes and rows have accessible names and keyboard navigation.
- At compact widths, the header shows participants, health, and target only; secondary information
  remains available through Project info.
- Light and dark themes use semantic tokens only.

## Deferred

- New external-system connectors.
- A new Project membership model.
- Automated Project health generation beyond existing human/update writes.
- Cross-workspace dependency edges that grant or imply access. Existing tenant isolation remains.
