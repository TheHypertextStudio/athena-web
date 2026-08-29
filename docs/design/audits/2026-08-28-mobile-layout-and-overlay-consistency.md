# Design review: Mobile layout and overlay consistency — 2026-08-28

This audit is for Docket web and UI maintainers. They must repair the shared shell, surface, and
overlay contracts before they patch individual screens. The current app is below the ship bar.
Mobile failures come from shared layout decisions, so another round of call-site padding changes
will only move the defects.

The evidence set contains 172 screenshots across 87 named routes, screens, and interaction states:
[screenshot index](./screenshots/2026-08-28-mobile-layout-audit/). The standard app capture is
390 by 844 pixels in light and dark themes. The set also includes 1440 by 900 desktop comparisons,
320 by 844 overflow states, 390 by 600 short-viewport overlay states, and 379 by 820 compact
marketing captures.

## Verdict

**BELOW BAR.** Every rubric dimension scores below 3. The responsive, accessibility, and theme
parity gates fail. The most serious defects are inaccessible clipped filter controls, page chrome
that deliberately creates internal scrolling, a horizontally scrolling composer at 320 pixels,
and overlay implementations that bypass the shared primitives.

## Scorecard

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     2 | The main app uses calm, compact chrome in [Today](./screenshots/2026-08-28-mobile-layout-audit/app-today-390x844-light.png), while the standalone [mobile Focus route](./screenshots/2026-08-28-mobile-layout-audit/app-focus-390x844-light.png) removes that system and becomes a different full-page composition. The [Event drawer](./screenshots/2026-08-28-mobile-layout-audit/overlay-event-drawer-390x844-light.png) introduces another overlay treatment.                                                                                                      |
| 2. Typographic craft                |     2 | The base type hierarchy is legible, but the [Inbox category row](./screenshots/2026-08-28-mobile-layout-audit/app-inbox-390x844-light.png) cuts “Announcements” mid-label. The [320-pixel composer](./screenshots/2026-08-28-mobile-layout-audit/overlay-initiative-composer-320x844-light.png) wraps “Create more” and truncates the template action inside a horizontal scroller.                                                                                                                                                                                    |
| 3. Spatial rhythm and density       |     1 | The [composer](./screenshots/2026-08-28-mobile-layout-audit/overlay-initiative-composer-320x844-light.png) combines a 16-pixel viewport gutter with independent section and editor insets. The [Display popover](./screenshots/2026-08-28-mobile-layout-audit/overlay-display-390x600-light.png) mixes 12- and 16-pixel content axes. The [Agenda rail](./screenshots/2026-08-28-mobile-layout-audit/desktop-today-agenda-1440x900-dark.png) retains an extra 12-pixel schedule gutter.                                                                                |
| 4. Hierarchy and information design |     2 | The [Display popover](./screenshots/2026-08-28-mobile-layout-audit/overlay-display-390x600-light.png) puts layout, grouping, sorting, and property configuration in one long floating panel. The [command palette](./screenshots/2026-08-28-mobile-layout-audit/overlay-command-palette-390x844-light.png) uses a bespoke dialog-sized menu instead of an owned command presentation.                                                                                                                                                                                  |
| 5. Color discipline                 |     1 | The dark [Agenda rail](./screenshots/2026-08-28-mobile-layout-audit/desktop-today-agenda-1440x900-dark.png) changes tone at the header, time gutter, empty state, and outer panel without one semantic owner. The dark [Filter popover](./screenshots/2026-08-28-mobile-layout-audit/overlay-filter-390x844-dark.png) is another raw `surface-container-low` floating surface, while dialogs use `surface-container-high` and the Event drawer uses `surface`.                                                                                                         |
| 6. Motion and feedback              |     2 | Shared dialogs have tokened motion, but [EventDrawer](../../../apps/web/src/components/stream/event-drawer.tsx) supplies no shared focus or dismissal lifecycle. [CommandPalette](../../../apps/web/src/components/command-palette/command-palette.tsx) rebuilds backdrop and exit behavior by hand. The captured [drawer](./screenshots/2026-08-28-mobile-layout-audit/overlay-event-drawer-390x844-light.png) and [palette](./screenshots/2026-08-28-mobile-layout-audit/overlay-command-palette-390x844-light.png) therefore do not share one interaction contract. |
| 7. States completeness              |     1 | The seeded [Initiatives roster](./screenshots/2026-08-28-mobile-layout-audit/workspace-initiatives-390x844-light.png) could not load, and the seeded [Project detail](./screenshots/2026-08-28-mobile-layout-audit/detail-project-390x844-light.png) fell into the generic page-unavailable state. The [Focus route](./screenshots/2026-08-28-mobile-layout-audit/app-focus-390x844-light.png) also failed to load its timer.                                                                                                                                          |
| 8. Detail craft                     |     1 | The [320-pixel composer](./screenshots/2026-08-28-mobile-layout-audit/overlay-initiative-composer-320x844-light.png) has a visible inner horizontal scrollbar. [Time](./screenshots/2026-08-28-mobile-layout-audit/app-time-390x844-light.png) clips controls past the right edge. [Calendar](./screenshots/2026-08-28-mobile-layout-audit/app-calendar-390x844-light.png) exposes a second scrollbar at the bottom of its schedule.                                                                                                                                   |

The average score is **1.5 out of 4**.

The gates are: A11y ❌ · Responsive ❌ · Theme parity ❌ · No placeholder ✅ ·
Screenshot-verified ✅.

- A11y fails because `EventDrawer` declares a modal dialog with raw elements but does not inherit
  the shared focus trap, Escape dismissal, scroll lock, or focus restoration.
- Responsive fails because the composer scrolls horizontally at 320 pixels, Time clips its control
  row at 390 pixels, and the Filter popover hides controls on a 600-pixel-tall viewport.
- Theme parity fails because floating and nested surfaces do not have one semantic role mapping.
  Light and dark screenshots are present, but the tonal hierarchy changes by component.
- No-placeholder passes. The audit used isolated local records, and it did not present demo data as
  production data.
- Screenshot verification passes for the scored claims. Source-only risks are marked as such below.

## Coverage and method

The route inventory found 84 `page.tsx` modules and 67 authenticated route patterns. Redirects,
dynamic variants that share one client surface, and nonvisual router entries do not each need a
duplicate image. The screenshot set covers the resulting unique visual surfaces and major states.

| Area                             | Named surfaces or states | Capture                                                                             |
| -------------------------------- | -----------------------: | ----------------------------------------------------------------------------------- |
| Global authenticated app         |                       13 | 390 by 844, light and dark                                                          |
| Shared workspace lists and tools |                       14 | 390 by 844, light and dark                                                          |
| Workspace settings               |                       15 | 390 by 844, light and dark                                                          |
| Personal settings                |                       11 | 390 by 844, light and dark                                                          |
| Entity details                   |                        9 | 390 by 844, light and dark                                                          |
| Overlays                         |                       10 | 390 by 844, both themes where reachable; short-height and 320 variants for failures |
| Canvas state                     |                        1 | 390 by 844, light and dark                                                          |
| Marketing and legal              |                        6 | 379 by 820; OS-dark checks on the primary marketing pages                           |
| Authentication                   |                        3 | 390 by 844, light and dark                                                          |
| Open router                      |                        1 | 390 by 844, light                                                                   |
| Desktop comparisons              |                        4 | 1440 by 900, light and dark                                                         |

The audit ran a production Next.js build from this checkout against an isolated local database and
a locally authenticated fixture. It did not touch production data or a billing provider. Google
Font downloads were unavailable during the stable production build, so that build used local
fallback font modules. That can move text metrics by a few pixels. It cannot explain the measured
scroll ownership, fixed insets, clipped controls, or contradictory surface roles.

The browser host crashed during the final broad 320-pixel batch. Public and authentication routes
had already passed the document-width probe. The composer and Sort state were captured at 320
pixels, and the Time toolbar had already been measured past the 390-pixel boundary. The audit does
not claim that every route completed a fresh 320-pixel probe after that crash.

## Findings

### P0 — The Filter popover clips controls and gives the user no way to reach them

At 390 by 600 pixels, the Filter panel measures 400 pixels high but contains 641 pixels of content.
Its inherited `overflow-hidden` clips the remaining 241 pixels. “Advanced filter” is not visible or
scrollable in [the short-viewport capture](./screenshots/2026-08-28-mobile-layout-audit/overlay-filter-390x600-light.png).

`PopoverContent` sets only a maximum height at
[`packages/ui/src/primitives/popover.tsx`](../../../packages/ui/src/primitives/popover.tsx). The
standard menu container supplies `overflow-hidden` in
[`packages/ui/src/primitives/menu-styles.ts`](../../../packages/ui/src/primitives/menu-styles.ts).
`FilterBuilder` then renders an exhaustive form without choosing a scroll owner in
[`apps/web/src/components/work-views/filter-builder.tsx`](../../../apps/web/src/components/work-views/filter-builder.tsx).

The fix belongs in a typed popover presentation. A searchable catalog needs a fixed search field,
one scrolling list, and a fixed terminal action. The app must not make the entire floating panel or
the page behind it compete for scroll.

### P0 — Entity details manufacture an internal scrollbar to animate the masthead

The newly reported detail-page scrollbar is intentional code, not content overflow.
`EntityDetailLayout` calls `useOwnPageScroll()`, disables shell scrolling, and gives its child
`overflow-y-auto` in
[`entity-detail-layout.tsx`](../../../apps/web/src/components/views/entity-detail-layout.tsx).
The `.detail-body` rule then sets
`min-block-size: calc(100cqb - 4rem + var(--detail-collapse-range))` in
[`globals.css`](../../../packages/ui/src/styles/globals.css). Its comment says that the rule creates
enough overflow to reach the collapsing-header endpoint. An otherwise-empty page therefore gets a
visible nested scrollbar. Mobile adds another 96 pixels of bottom padding through `pb-24`, so the
same fake overflow becomes larger at the narrow endpoint.

This violates the requested Linear-style model. The route needs one page scroller. A decorative
header transition cannot create fake document height or take scroll ownership away from the page.
The header should collapse only when real content scrolls. A short detail page should not scroll.

The shared shell also needs one alignment plane for the tab strip, main surface, and right utility
rail. `AppShell` stacks the 40-pixel tab bar above `<main>`, while `ShellAside` starts at the shell
row's top. The supplied screenshot therefore places the Focus rail 40 pixels above the main page
surface.

The current `entity-detail-collapse-contract.test.ts` locks the fabricated minimum block size by
reading the CSS source. That test protects the implementation mistake rather than user behavior.
Replace it with browser checks that a short detail page has no scrollbar, a long page has one route
scroll owner, and the header stays usable at both endpoints.

### P0 — The Initiative composer loses too much width and scrolls horizontally at 320 pixels

The 320-pixel panel is 288 pixels wide. The title starts 41 pixels from the viewport edge. The
description starts 53 pixels from the edge and has 214 pixels of usable width. The editor then
shows an inner horizontal scrollbar and truncates its template control in
[the capture](./screenshots/2026-08-28-mobile-layout-audit/overlay-initiative-composer-320x844-light.png).

`DialogContent` owns a 16-pixel viewport gutter. `ComposerShell` resets the default dialog padding
and rebuilds independent 24-pixel section insets in
[`composer-shell.tsx`](../../../apps/web/src/components/composer/composer-shell.tsx). The editor
adds another 12-pixel inset. The fixed 75dvh composer height also turns the empty editor into a
large blank well.

The fix is one mobile inset at the dialog presentation boundary. Header, editor, properties, and
footer must share that axis. Controls that do not fit must collapse into the existing overflow
menu. They must not scroll horizontally inside the form.

### P0 — Time clips its range controls instead of applying progressive disclosure

The range row continues past the viewport in
[the mobile Time capture](./screenshots/2026-08-28-mobile-layout-audit/app-time-390x844-light.png).
The final arrow begins at 389 pixels and ends at 431 pixels. The following Filters control begins at
439 pixels and ends at 531 pixels. The document remains 390 pixels wide, so the controls are clipped
rather than reachable through a page scrollbar.

This row must use the same nonwrapping progressive-disclosure rule as the main editor toolbar. Keep
the active range and the highest-priority action inline. Move the rest into one named overflow
menu. Do not add a horizontal scroller.

### P1 — Detail actions align to a synthetic two-row identity box

The reported Project Publish and More buttons use the same shared 40-pixel control size. Their
geometry is not the defect. They float between the glyph and title because `.detail-primary` uses
`align-items: center`, while `.detail-title` adds 3.75rem of top padding. The buttons are a sibling
of that padded identity block in
[`entity-detail-layout.tsx`](../../../apps/web/src/components/views/entity-detail-layout.tsx), and
the CSS lives in [`globals.css`](../../../packages/ui/src/styles/globals.css). A wrapped editable
title auto-grows and moves the centered action lane again.

The masthead needs explicit rows. The glyph, title, metadata, and action lane should each align to a
named row. Centering controls against an element whose padding impersonates another row cannot
produce a stable baseline at different pane widths.

The current source-contract test requires `align-items: center`, while the browser evidence checks
actions only after forcing the compact header endpoint. The tests therefore miss the expanded
state shown in the report. The replacement browser check must measure the visible title baseline
and action center in both expanded and compact states.

### P1 — Display uses one long internal scroller over another scrolling page

At 390 by 600 pixels, the Display panel is 400 pixels high and has 1,098 pixels of content. It
turns the whole popover into an internal scroller in
[the short-viewport capture](./screenshots/2026-08-28-mobile-layout-audit/overlay-display-390x600-light.png).
Its underlying work list remains independently scrollable. The Organize wrapper also uses a
12-pixel inset while the shared section labels use 16 pixels, which creates the visible four-pixel
axis error.

`DisplayControls` must become a compact command surface. Layout remains immediate. Organize and
Properties should open owned subpanels or routes. One giant floating form is the wrong information
shape even after its padding is fixed.

### P1 — The app contains bespoke modal implementations

The [Event drawer](./screenshots/2026-08-28-mobile-layout-audit/overlay-event-drawer-390x844-light.png)
uses a raw fixed wrapper, a `bg-black/25` button as its scrim, and a 420-pixel `aside` in
[`event-drawer.tsx`](../../../apps/web/src/components/stream/event-drawer.tsx). It bypasses the
shared focus, Escape, scroll-lock, layer, surface, radius, elevation, and mobile-presentation
contracts.

The [command palette](./screenshots/2026-08-28-mobile-layout-audit/overlay-command-palette-390x844-light.png)
also builds a modal from raw elements in
[`command-palette.tsx`](../../../apps/web/src/components/command-palette/command-palette.tsx). It
uses the transient-menu layer, a hard-coded 12vh top inset, and a 70vh maximum height despite
declaring `role="dialog"`.

Both components must migrate to typed shared presentations. The command palette can keep its search
behavior, and Event details can keep a side-drawer presentation. Neither needs to own modal
infrastructure.

### P1 — Mobile Focus has two separate visual models and two potential scroll owners

The standalone [Focus mobile capture](./screenshots/2026-08-28-mobile-layout-audit/app-focus-390x844-light.png)
does not retain the main app's top bar, tab strip, surface hierarchy, density, or spacing. The
`(focus)` route group explicitly omits `AppShellFrame` in
[`apps/web/src/app/(focus)/layout.tsx`](<../../../apps/web/src/app/(focus)/layout.tsx>), and
`FocusImmersive` replaces it with a custom header and breakpoint-specific page grid in
[`focus-immersive.tsx`](../../../apps/web/src/components/time-tracking/focus-immersive.tsx).

The shell's mobile utility-pane path has a separate source defect. `SheetContent` wraps the active
panel in `overflow-auto` in `AppShell.tsx`, while `FocusPanel` gives its own body `overflow-auto` in
`focus-panel.tsx`. That composition can create nested scroll owners on mobile. This exact utility
pane state was not recaptured after the browser host crashed, so this paragraph records a
source-owned risk rather than a screenshot claim.

Mobile and coarse pointers also enter the standalone route in the same tab. That route asks the
shared timer controls for their separate `comfortable` sizing mode and lacks the shell canvas,
mobile bar, tab strip, organization accent context, and shell density attribute. The divergence is
therefore an explicit presentation branch rather than a responsive version of the main app.

Focus can remain immersive without becoming a separate design system. It should reuse the main
app's mobile bar, page surface, control sizes, and spacing tokens. The utility pane must nominate
one scroll owner.

### P1 — Floating surfaces have no single semantic color contract

The codebase contains 553 `bg-surface*` utility occurrences across 247 non-test TSX files in
`apps/web/src` and `packages/ui/src`. It contains only 13 runtime `<Surface>` calls. The semantic
component is not the ownership boundary its documentation claims.

The role mapping also disagrees across primitives. Dialogs use `surface-container-high`. Menus and
popovers use `surface-container-low`. Hover cards use `surface`. Tooltips use
`surface-container-highest`. EventDrawer uses `surface`. The dark
[Agenda capture](./screenshots/2026-08-28-mobile-layout-audit/desktop-today-agenda-1440x900-dark.png)
shows the resulting seams between the outer panel, header, time gutter, and empty-state chip.

The team must settle one semantic map before it starts a mechanical migration. `Surface` also needs
to express the shell canvas role. Feature code should then choose a semantic component or a named
domain surface, not a raw tonal step.

### P1 — Calendar and canvas content retain page furniture that should be full bleed

The Projects dependency canvas keeps a 12-pixel horizontal gutter in
[the mobile capture](./screenshots/2026-08-28-mobile-layout-audit/state-project-dependencies-390x844-light.png).
`ProjectGraphPanel` also cancels 16, 24, and 32 pixels of bottom margin while its page container
uses a 16-pixel wide-screen inset. The larger cancellations exceed the page inset by 8 and 16
pixels in [`project-graph-panel.tsx`](../../../apps/web/src/components/canvas/project-graph-panel.tsx).

The Agenda schedule keeps an extra 12-pixel `px-3` wrapper in
[`agenda-canvas.tsx`](../../../apps/web/src/components/agenda/agenda-canvas.tsx). The desktop
[Agenda capture](./screenshots/2026-08-28-mobile-layout-audit/desktop-today-agenda-1440x900-light.png)
shows the timed grid starting 12 pixels inside the rail instead of meeting its frame.

Canvas and schedule surfaces should own their full-bleed geometry through a page presentation.
Negative-margin corrections at feature call sites are not a layout contract.

### P1 — Several seeded routes fail before layout can be judged

Initiatives, Programs, Projects, and Tasks entered application-owned load errors during the stable
capture. Several entity details entered the generic Page unavailable screen. The local server also
reported attempts to call `apiQueryOptions()` from a server component on affected routes.

These are runtime defects, not visual defects. They still block the audit because an error screen
cannot prove the happy-path layout. The audit preserves the states in the workspace and detail
screenshots instead of claiming those routes passed.

### P2 — Inbox and Calendar expose scrollers as primary chrome

[Inbox](./screenshots/2026-08-28-mobile-layout-audit/app-inbox-390x844-light.png) uses a horizontal
category scroller that cuts the last label. [Calendar](./screenshots/2026-08-28-mobile-layout-audit/app-calendar-390x844-light.png)
shows both its vertical schedule scroller and a bottom horizontal scrollbar. These controls feel
like embedded widgets rather than the page itself.

The page should keep one visible scrolling axis. Lower-priority Inbox categories belong in an
overflow menu. Calendar can retain native schedule panning, but its scrollbar chrome and
overscroll background must be owned by the schedule presentation rather than exposed as a second
page frame.

### P2 — The recovery banner report maps to source but was not reproduced

`RecoveryNudgeBanner` uses `rounded-lg p-2.5`, a nested two-row flex layout, negative close-button
margins, and a separately indented link in
[`recovery-nudge-banner.tsx`](../../../apps/web/src/components/recovery-nudge-banner.tsx). The
fixture had nine healthy recovery codes, so the component correctly rendered nothing. The audit
therefore does not claim a live reproduction of the supplied clipping screenshot.

The banner needs a shared inline-banner presentation and a mobile safe-area check when a low-code
fixture becomes available. The footer must own the outside inset. The banner must own only its
inside inset.

### P2 — The widest shared menu width contradicts its mobile guarantee

`MENU_WIDTH.xl` sets a 352-pixel minimum while the container caps itself at `100vw - 24px` in
[`menu-styles.ts`](../../../packages/ui/src/primitives/menu-styles.ts). CSS resolves the conflicting
minimum and maximum in favor of the minimum. That contract cannot fit a 320-pixel viewport.

The captured [320-pixel Sort submenu](./screenshots/2026-08-28-mobile-layout-audit/overlay-sort-menu-320x844-light.png)
used the default 224-pixel width and did not reproduce the overflow. The 352-pixel issue is a
source-only latent defect, not a claim about that image.

### P2 — Calendar creation works visually but rebuilds the shared dialog contract

The [mobile create sheet](./screenshots/2026-08-28-mobile-layout-audit/overlay-calendar-create-390x844-light.png)
is one of the better responsive results. It still arrives through a single `DialogContent` call
that replaces position, size, transforms, overflow, shape, border, padding, and shadow in
[`create-block-form.tsx`](../../../apps/web/src/components/calendar/create-block-form.tsx).

This call site proves that the primitive needs typed `centered`, `hosted`, `fullscreen`, and
`bottom-sheet` presentations. The current output should become a shared variant rather than remain
a sanctioned escape hatch.

## Required repair order

1. Remove manufactured detail-page overflow. Establish one route scroll owner and align the tab
   strip, main surface, and utility rail to one shell grid.
2. Define typed Dialog, Sheet, Popover, and Command presentations with one body scroll owner, one
   inset axis, and owned surface, shape, elevation, layer, and scrim roles.
3. Migrate EventDrawer, CommandPalette, ComposerShell, DisplayControls, FilterBuilder, and
   CreateBlockForm to those presentations.
4. Fix mobile progressive disclosure in Time and Inbox. Remove horizontal form and category
   scrollers.
5. Settle the semantic surface role map. Add the missing shell-canvas role and migrate raw resting
   surfaces in controlled slices.
6. Remove the Agenda outer gutter and the Project canvas negative-margin corrections through
   full-bleed page presentations.
7. Resolve the list and detail runtime errors, then recapture the happy paths and the recovery
   banner state.
8. Add lint enforcement only after the shared APIs exist. Product tests must verify behavior. Lint
   rule tests must verify the rules. Source-scanning product tests are not an acceptable substitute.
