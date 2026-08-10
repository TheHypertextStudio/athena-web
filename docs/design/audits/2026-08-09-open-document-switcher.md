---
date: 2026-08-09
surface: Open-document switcher
route: /today (authenticated shell, six persisted open documents)
verdict: ship
---

# Design review: Open-document switcher — 2026-08-09

Screenshots:

- [1440×900 light](screenshots/2026-08-09-open-document-switcher/switcher-1440x900-light.png)
  and [dark](screenshots/2026-08-09-open-document-switcher/switcher-1440x900-dark.png)
- [390×844 light](screenshots/2026-08-09-open-document-switcher/switcher-390x844-light.png)
  and [dark](screenshots/2026-08-09-open-document-switcher/switcher-390x844-dark.png)
- [320×844 light, open](screenshots/2026-08-09-open-document-switcher/switcher-320x844-light.png)
- [Visible link focus](screenshots/2026-08-09-open-document-switcher/switcher-1440x900-light-tab-focus.png)

The live pass used an authenticated throwaway workspace and six persisted documents, including
titles long enough to force truncation. Computed DOM measurements were identical across both
themes and widths: the panel was 352px wide, every row had 16px leading and trailing padding,
and the close actions had 0px inline margins. With the switcher open at 320px, the panel clamped
to 296px while the document measured 320px client width and 320px scroll width, so the surface
introduced no horizontal overflow.

| Dimension                   | Score | Evidence                                                                                                                                                                                                                        |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | The screenshots stay in the app's calm Plex/MD3 register: neutral surfaces, type glyphs, and the direct “Search open documents” task language.                                                                                  |
| 2. Typographic craft        | 3     | Search text uses the XL field's body token; result labels use the shared `label-large` menu role; titles truncate cleanly rather than wrapping or clipping.                                                                     |
| 3. Spatial rhythm & density | 4     | Live measurements show a strict 352px panel, symmetric 16px row insets, 40px close targets, and zero trailing margin. Six documents remain readily scannable at both widths.                                                    |
| 4. Hierarchy & information  | 4     | The panel opens directly into its one primary action—search—then presents results in ordinary focus order. The redundant “Open documents” heading is gone, while the trigger count preserves context in the tab bar.            |
| 5. Color discipline         | 3     | Light and dark screenshots use only semantic neutral surface/text/ring roles; the same hierarchy and readable contrast survive both themes without decorative color.                                                            |
| 6. Motion & feedback        | 3     | The settled screenshots show the shared inset focus ring; the live pass verified search → link → close focus, Escape focus restoration, and shortcut reopening. Popover motion settles without changing geometry.               |
| 7. States completeness      | 3     | Six-item overflow and long-title truncation are screenshot-verified. Component tests cover case-insensitive filtering, the no-results message, active-document treatment, close focus recovery, and Enter activation.           |
| 8. Detail craft             | 4     | Leading 20px type glyphs and trailing 20px close glyphs sit against equal 16px outer insets; the close control keeps a 40px target without extra end margin. The open 320px overflow check and visible-focus capture both pass. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Interaction evidence

- Search owns focus on pointer open and on Command/Control+Shift+A.
- Tab moves search → first document link → its close action, with a visible shared focus ring.
- Escape closes the surface and restores the trigger; reopening through Command+Shift+A restores
  the search field.
- Arrow Up/Down wrap across document links, Enter activates the focused link, and closing a result
  moves focus to the nearest remaining result.
- The close button is 40×40px, with a 20px glyph aligned to the row's trailing edge; the leading
  glyph is also 20px, so the visible start/end inset matches without adding a trailing margin.

## Findings resolved during the pass

1. The first implementation preserved a 24×24px close control from the desktop dropdown. That
   failed the mobile touch-target gate even though the row itself was 44px tall. The final control
   uses the shared XL 40px geometry, keeps its glyph aligned to the end, and retains 0px margin
   (`packages/ui/src/components/shell/tab-overflow-menu.tsx:217`).

## Follow-up resolved

The repeated-reload capture exposed a hydration mismatch in the shell's Account menu. Its row
started a second Better Auth session hook even though `AppShellFrame` had already resolved the
viewer server-side, so a server-confirmed identity and a still-pending first client session could
produce different trees. The account row now receives the shell's one resolved display identity.
The regression test first reproduced the missing row with a server identity and pending client
session, then passed after the fix; a follow-up live audit completed eight authenticated hard
reloads with the Account menu present and no hydration warnings or page errors.

Verdict: **SHIP** — every dimension is at least 3 and all five gates pass for the open-document
switcher.
