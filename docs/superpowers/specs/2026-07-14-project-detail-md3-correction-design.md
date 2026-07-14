# Project Detail and MD3 Typography Correction

## Objective

Make the first viewport of every Project detail route belong to the Project itself, while removing
Docket's ad hoc application typography tokens in favor of the canonical Material Design 3 type
scale.

## Canonical typography

The application type system exposes only the MD3 semantic names: `display-large`,
`display-medium`, `display-small`, `headline-large`, `headline-medium`, `headline-small`,
`title-large`, `title-medium`, `title-small`, `body-large`, `body-medium`, `body-small`,
`label-large`, `label-medium`, and `label-small`.

The existing `document-title`, `page-title`, `h1`, `h2`, `h3`, `body`, and `mono` application
tokens are removed rather than retained as aliases. Application call sites migrate to the MD3
names, and source contracts reject reintroduction of the old names. Monospaced text keeps the
appropriate MD3 size token and adds `font-mono` separately.

Project and Initiative overview titles use `headline-medium`; their detail titles use
`headline-large`. Markdown document `h1`,
`h2`, and `h3` use `headline-medium`, `headline-small`, and `title-large`. Project summaries and
document prose use normal-weight `body-large`; supporting and table text use the smaller MD3 body
or label tokens appropriate to their role.

## Project detail hierarchy

The Project display icon sits above the title and uses a smaller glyph inside its existing
interactive container. The redundant fallback `Project` context line is omitted; a real Program
may remain as meaningful context. The title, summary, people when present, health, and target date
all appear before the tabs.

An empty participant set renders nothing. Health and target date are real buttons with MD3 state
layers, visible focus treatment, and unchanged minimum 40dp targets. Both open the same anchored
`Properties` disclosure. The disclosure trigger uses a rounded tune icon and the plain label
`Properties`; it is never called `Project info`.

The generated document contents gutter exists only when the Markdown document has at least two
headings. Without contents, the document occupies the full available width. With contents, the
desktop gutter and compact disclosure retain keyboard focus and active-section behavior.

## Shell behavior

The recovery-code nudge remains available on Home and workspace overview routes but does not render
on object-detail routes for Projects, Initiatives, Tasks, Programs, or Cycles. Account recovery is
important, but it cannot displace the primary object on a working detail surface.

## Icon sizing

Project and Initiative overview/detail glyphs move down one MD3 icon size while their circular
containers and 40dp interaction targets remain unchanged. Navigation and unrelated global controls
are not mechanically shrunk.

## Acceptance criteria

- No production source uses the removed application typography token names.
- Project and Initiative detail titles use `headline-large`.
- Project summary and Markdown prose use normal-weight `body-large`.
- Object-detail routes do not receive the recovery nudge.
- The Project icon precedes the title vertically, and no redundant `Project` overline is rendered.
- Empty Project people render no copy or reserved gap.
- Health, target, and Properties affordances look and behave as interactive controls.
- Documents without a table of contents do not reserve a contents column.
- Existing keyboard, responsive, and light/dark behavior remains intact.
