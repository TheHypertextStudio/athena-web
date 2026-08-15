---
surfaces: ['orgs-[orgId]-settings-publishing']
date: 2026-08-14
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Settings → Publishing — 2026-08-14

Screenshots (1440×900 + 390×844, light + dark):

- [desktop light](screenshots/2026-08-14-publishing-desktop-light.png) · [desktop dark](screenshots/2026-08-14-publishing-desktop-dark.png)
- [mobile light](screenshots/2026-08-14-publishing-mobile-light.png) · [mobile dark](screenshots/2026-08-14-publishing-mobile-dark.png)
- [empty state, desktop light](screenshots/2026-08-14-publishing-empty-desktop-light.png)

Interaction states (1440×900 light):

- [copy control hover](screenshots/2026-08-14-publishing-copy-hover.png) · [copy control focus-visible](screenshots/2026-08-14-publishing-copy-focus.png) · [copy control copied](screenshots/2026-08-14-publishing-copy-copied.png)
- [button hover](screenshots/2026-08-14-publishing-button-hover.png) · [copied under prefers-reduced-motion](screenshots/2026-08-14-publishing-copied-reduced-motion.png)

The two-level settings pane at 390×844 (the shell fix behind finding 1):

- [section list, light](screenshots/2026-08-14-settings-list-mobile-light.png) · [section list, dark](screenshots/2026-08-14-settings-list-mobile-dark.png)
- [Settings → General, the control surface](screenshots/2026-08-14-settings-general-mobile-light.png)

Captured against a live local stack (PGlite + API + web on localhost) through
`e2e/tools/dev-session.ts` and `e2e/tools/capture-shots.ts`. States exercised: no custom domains
(empty), two claimed-but-unverified domains with their DNS records disclosed, and a default address
on a deployment with no shared brief host configured. The interaction pass drives the surface
directly — hover by pointer, focus by `Tab`, the copy swap by `Enter` — and asserts
`data-copy-state="copied"` before each capture, so an acknowledgement that never fired cannot be
filed as one that did.

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | Calm MD3 register throughout; copy is application-owned and specific ("Add this record at your DNS provider, then check it."). No provider or exception text reaches the surface — verification failures map through `VERIFY_FAILURE_COPY`.                                                                                                                                                                                                          |
| 2. Typographic craft        | 3     | MD3 tokens only (`body-medium` for addresses, `label-small` for record labels, `title-*` via `SectionHeader`); `font-mono` reserved for the DNS record values, which are identifiers. Two levels of hierarchy per row, no arbitrary sizes.                                                                                                                                                                                                           |
| 3. Spatial rhythm & density | 3     | A collapsed row measures 56px — MD3's one-line list item — from a 40px control line plus `py-2`, so height comes from the control scale rather than from padding. One `ROW_INDENT` (`pl-7`) lines every disclosed block up with the host above it.                                                                                                                                                                                                   |
| 4. Hierarchy & information  | 3     | One primary action (`Add domain`) in the subsection header; `Check DNS` is a subordinate outline button; the destructive Remove is a ghost icon that asks before acting. Nothing on the surface competes with the address list.                                                                                                                                                                                                                      |
| 5. Color discipline         | 3     | Fully neutral, semantic tokens only. Depth is carried by a three-step surface-container ladder (row `-low` → record block `container` → copy hover `-high`) with no outline anywhere on the surface. Both themes verified.                                                                                                                                                                                                                           |
| 6. Motion & feedback        | 3     | Captured, not asserted. Hover tints the control and lifts its icon from 60% to full; focus-visible draws the shared ring with the pointer away; `Enter` swaps Copy for Check and announces in the polite live region. Bare `transition-*` runs at `--dur-fast` (globals.css sets `--default-transition-duration`), and the global reduced-motion block cuts transitions to 0.01ms — the copied state still lands there, verified in its own context. |
| 7. States completeness      | 3     | Empty, populated, unverified-with-records, and not-reachable-default all captured; loading renders `Skeleton` rows matching the final layout. No dead read-only rows remain — the read-only slug box and its "go elsewhere" button are gone.                                                                                                                                                                                                         |
| 8. Detail craft             | 3     | DNS records hold aligned label/value columns across both domain rows, with the copy controls forming their own aligned right column. A 51-character domain wraps inside its cell rather than overflowing. 320px overflow check passed.                                                                                                                                                                                                               |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

A11y was re-checked at 390px rather than inferred from the reflow: the back control exists only
below `sm`, it is a 44px target, using it shows the section list with all 19 sections as ordinary
links, and choosing one returns to that section. Nothing on the phone is reachable only by pointer,
and nothing is reachable only on a wide viewport.

## Findings (ordered by severity)

None open. Both findings this review raised are closed; each is recorded below with what it was.

## Fixed during this review

- **The default address printed a bare slug where no shared brief host is configured** — exactly the
  state the original report showed in production (`lvbt` alone in a box). It now carries a
  `Not reachable` badge instead of `Default`, so a naked identifier is never presented as an address.
- **`Default` and `Primary` both sat on the same row when it was the only address.** `Primary`
  answers "which of these?", so it now renders only where there is more than one address to choose
  between — reintroducing a two-badges-for-one-fact duplication on the surface built to end exactly
  that would have been an unusually poor joke.
- **The record type offered a copy control.** A registrar presents `TXT` as a fixed choice, so there
  was nowhere to paste it, and at three characters wide the control left its icon stranded at the
  far end of the aligned column. Type is now plain text; only Name and Value — the two fields
  anyone transcribes — are controls.
- **Rows were 72px tall for one line of text** — MD3's _two-line_ height. Measured in the DOM: the
  40px icon button set the line, and `p-4` added another 32px on top of it, so the row was sized by
  its padding rather than by its control scale. The button stays 40px (the minimum touch target);
  the padding came down to `py-2`, landing the row on 56px exactly.
- **The surface reached for outlines where MD3 uses tint.** Both lists were bordered boxes with
  hairline dividers, and three badges carried the outline variant. Rows are now
  `surface-container-low` tiles in a spaced stack, each disclosed DNS block sits one tint step above
  its row, and every badge is filled. No border remains on the surface.
- **The settings shell did not reflow at 390px** (finding 1). The nav rail is a fixed `w-52`, and
  beside the shell's `gap-8` and `p-5` that cost 280px — leaving the content pane roughly 110px,
  which clipped the `Addresses` heading mid-word, pushed `Add domain` off-screen, and wrapped "Add
  this record at your DNS provider, then check it." to one word per line. Below `sm` the pane now
  shows one view at a time: the section list fills it, choosing from the list replaces it with that
  section, and an `All settings` control goes back. The mobile captures above show all three
  symptoms gone. Because the rail belongs to the shell, this was never fixable inside
  `publishing-settings.tsx`; it landed on `claude/amazing-bardeen-d0cff1` as
  `fix(web): Make every settings section usable on a phone`, which is **not merged yet** — the gates
  above describe the surface as captured with that change applied.

  A dropdown picker was tried first and rejected on review: 19 sections in a floating overlay
  scrolled past the viewport, hid the four-group structure the rail makes legible at a glance,
  floated over the content it was about to replace, and made its selected row the one saturated
  colour on an otherwise calm surface. Recorded because the discarded shape is the more tempting
  one — it is a smaller change, and it looks reasonable until you see it at 390px.

- **Interaction states were unproven** (finding 2). Hover, focus-visible, the copy control's
  `copied` swap, and `prefers-reduced-motion` are now captured rather than argued from the
  implementation, which is what moves dimension 6 off 2. Re-capturing also caught a header defect
  the earlier shots had not: the workspace switcher's trigger is `w-full`, and with nothing bounding
  it the chip stretched the full header and pushed its own chevron under the close button at every
  width, desktop included. It now sits in a `min-w-0 max-w-64` box and truncates.

Verdict: **SHIP** — five green gates and every dimension at the bar. Conditional on the shell fix
landing: revert to below-bar if `claude/amazing-bardeen-d0cff1` does not merge, since Responsive and
A11y depend on it.
