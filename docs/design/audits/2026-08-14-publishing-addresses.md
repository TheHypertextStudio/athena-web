---
surfaces: ['orgs-[orgId]-settings-publishing']
date: 2026-08-14
verdict: below-bar
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 2
  states: 3
  detail: 3
gates:
  a11y: false
  responsive: false
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Settings → Publishing — 2026-08-14

Screenshots (1440×900 + 390×844, light + dark):

- [desktop light](screenshots/2026-08-14-publishing-desktop-light.png) · [desktop dark](screenshots/2026-08-14-publishing-desktop-dark.png)
- [mobile light](screenshots/2026-08-14-publishing-mobile-light.png) · [mobile dark](screenshots/2026-08-14-publishing-mobile-dark.png)
- [empty state, desktop light](screenshots/2026-08-14-publishing-empty-desktop-light.png)

Captured against a live local stack (PGlite + API on `localhost:4330` + web on `localhost:4200`)
through `e2e/tools/dev-session.ts` and `e2e/tools/capture-shots.ts`. States exercised: no custom
domains (empty), two claimed-but-unverified domains with their DNS records disclosed, and a default
address on a deployment with no shared brief host configured.

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                     |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | Calm MD3 register throughout; copy is application-owned and specific ("Add this record at your DNS provider, then check it."). No provider or exception text reaches the surface — verification failures map through `VERIFY_FAILURE_COPY`.  |
| 2. Typographic craft        | 3     | MD3 tokens only (`body-medium` for addresses, `label-small` for record labels, `title-*` via `SectionHeader`); `font-mono` reserved for the DNS record values, which are identifiers. Two levels of hierarchy per row, no arbitrary sizes.   |
| 3. Spatial rhythm & density | 3     | One rhythm: `p-4` rows, `gap-3`/`gap-2` inside, and a single `ROW_INDENT` (`pl-7`) that lines every disclosed block up with the host text above it. Visible in the desktop shot as one continuous left edge down each expanded row.          |
| 4. Hierarchy & information  | 3     | One primary action (`Add domain`) in the subsection header; `Check DNS` is a subordinate outline button; the destructive Remove is a ghost icon that asks before acting. Nothing on the surface competes with the address list.              |
| 5. Color discipline         | 3     | Neutral except badges, all semantic tokens, zero hardcoded values. Dark shot verified: tinted surfaces still read as hierarchy and the divided list keeps its edges.                                                                         |
| 6. Motion & feedback        | 2     | **No evidence captured.** Static screenshots say nothing about hover, focus, or the copy control's `idle → copied` transition. Unverified is not a pass — see finding 3.                                                                     |
| 7. States completeness      | 3     | Empty, populated, unverified-with-records, and not-reachable-default all captured; loading renders `Skeleton` rows matching the final layout. No dead read-only rows remain — the read-only slug box and its "go elsewhere" button are gone. |
| 8. Detail craft             | 3     | DNS records hold aligned label/value columns across both domain rows, with the copy controls forming their own aligned right column. A 51-character domain wraps inside its cell rather than overflowing. 320px overflow check passed.       |

Gates: A11y ❌ (see finding 1) · Responsive ❌ (see finding 1) · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings (ordered by severity)

1. **The settings shell does not reflow at 390px, so most of this surface is unreachable on a
   phone.** The nav column keeps its full width and the content pane is left roughly 130px, which
   clips the `Addresses` heading mid-word, pushes `Add domain` off-screen, and wraps "Add this
   record at your DNS provider, then check it." to one word per line. This fails Responsive, and it
   fails A11y for the same reason — content that cannot be reached cannot be operated.

   **Not caused by this surface.** A control capture of Settings → General at the same width clips
   identically, so the defect belongs to the settings dialog shell
   (`apps/web/src/components/settings/settings-shell.tsx` and `settings-shell-nav.tsx`), which every
   section inherits. Fixing it inside `publishing-settings.tsx` is impossible; it needs the shell to
   collapse its nav below a breakpoint. Tracked separately.

2. **`Type` copies from a control ~500px wider than the value it copies.** The copy button is
   `w-full` so the icon can hold the aligned right column, which is correct for `Name` and `Value`
   where the text nearly fills the row. `TXT` is three characters, so the row reads as an icon
   marooned from its label. Consider capping the control's width to its content plus the icon while
   keeping the icons aligned — `apps/web/src/components/publishing/copy-value.tsx:47`.

3. **Interaction states are unproven.** Hover, active, focus-visible, the copy control's `copied`
   swap, and `prefers-reduced-motion` were all left uncaptured. The implementation uses the shared
   focus-ring utility and the `useCopyFeedback` state machine, but the rubric scores evidence, not
   intent. Needs an interaction pass before dimension 6 can move off 2.

## Fixed during this review

- **The default address printed a bare slug where no shared brief host is configured** — exactly the
  state the original report showed in production (`lvbt` alone in a box). It now carries a
  `Not reachable` badge instead of `Default`, so a naked identifier is never presented as an address.
- **`Default` and `Primary` both sat on the same row when it was the only address.** `Primary`
  answers "which of these?", so it now renders only where there is more than one address to choose
  between — reintroducing a two-badges-for-one-fact duplication on the surface built to end exactly
  that would have been an unusually poor joke.

Verdict: **BELOW BAR** — the Responsive and A11y gates fail on the shared settings shell, and
dimension 6 has no evidence. The surface's own composition is at the bar in every other dimension.
