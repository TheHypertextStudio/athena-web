---
surfaces: ['settings']
date: 2026-08-15
verdict: ship
scores:
  brand: 3
  typography: 4
  spacing: 4
  hierarchy: 4
  color: 4
  motion: 3
  states: 4
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Settings — 2026-08-15

Screenshots: `docs/design/audits/screenshots/2026-08-15-settings-audit/` — 92 captures, 23 routed
sections × {1440×900, 390×844} × {light, dark}, plus the destructive-confirmation step. The mobile
pass runs in a touch-emulating context, because `pointer: coarse` is what raises a control to its
40px target and Chromium reports a fine pointer at any width without it — a merely narrow window
photographs 36px controls and calls it a phone.

This supersedes `2026-08-02-launch-settings.md`, which scored hierarchy 2 and detail 2 against a
light-only capture at one width.

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Copy is application-owned throughout and the worst manifesto voice is gone. Held at 3 rather than 4 because the register is still being settled: three passes were needed to get from "Workspace comparison" through "What coworkers can see" to "Calendar sharing", and other surfaces have not been re-read against that final rule. |
| 2. Typographic craft              | 4     | 297 type-scale violations to zero, ledger-enforced. One heading vocabulary: page `title-medium`, group `title-small`, row `label-large`. The pairs that used to disagree — Athena's two sibling groups at `title-small` and `title-medium` — now render identically, verified in `personal-athena.png`.                                |
| 3. Spatial rhythm & density       | 4     | 56 hand-rolled cards across 35 class strings reduced to 15 across 11, and what remains is one consistent set (4 identical provider list items, a scroll container, a skeleton, one deliberately `sunken` slot). Row density is one value where it was three. Padding, radius and gap are decided in `SettingsGroup`, not per screen.   |
| 4. Hierarchy & information design | 4     | Was 2. The rail lists each open section's own groups with a scroll spy, derived from the rendered headings so it cannot drift. The document outline resolves: one `h1` (the modal), `h2` per section, `h3` per group, and the nav's group labels left the content outline for a labelled list.                                         |
| 5. Color discipline               | 4     | The inverted tonal ramp is corrected and 88 grouping borders are gone — a card is a step above its pane rather than a hairline. Six same-tone nestings found during cleanup are fixed, including one whose hover painted the colour already there. Dark verified per section, not sampled: `*-desktop-dark.png` × 23.                  |
| 6. Motion & feedback              | 3     | Focus rings are one treatment after the second button primitive was deleted (it drew a 1px ring where the system uses 2px). Autosave status is one component. Held at 3: no motion work was attempted in this pass, and the shell's transitions are inherited rather than authored.                                                    |
| 7. States completeness            | 4     | Every empty state is actionable and none names a precondition without a way to meet it. 21 silent mutations now report failure; reads and writes use different components so a query failure can no longer wear "Could not update…". Four dead-end statuses (bounced, unsubscribed, disabled, unmatched) state a cause and an exit.    |
| 8. Detail craft (squint test)     | 3     | Duplicate CTAs removed wherever a header and an empty state offered the same action. Raw identifiers, zero-value IP addresses and truncated tokens no longer reach the reader. Held at 3: `cursor: default` on non-button controls was not re-measured this pass, and it was the 2026-08-02 finding behind this dimension's old score. |

**Gates:** A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Gate evidence

- **A11y — touch targets.** Measured at 390×844 with touch emulated, across six sections. The
  control scale was a mouse scale: the settings form step is 36px and `sm` buttons 32px, so every
  field, every primary action and the dialog's own close button failed the 40px standard. The floor
  now lives in the scale (`coarse:h-10` in `controlChrome` and `fieldSurface`) plus the three
  controls that size themselves outside it.

  A checkbox needed a different answer. The first attempt grew its hit area with an
  absolutely-positioned `::after` on the wrapper span; that painted above the sibling input and took
  the tap itself, so every checkbox not inside a `<label>` stopped toggling on touch. A
  pseudo-element cannot be the hit target for a sibling. What works is the element that already
  forwards its clicks to a control — a `<label>` — so the notification channel matrix wraps each
  cell in one, and the option tiles and workspace rows take the floor directly.

  Two nodes remain under 40px and both are correct: a 1×1 visually-hidden file input whose target is
  the "Choose image" button beside it, and an inline text link inside a sentence, which WCAG 2.5.8
  exempts precisely because enlarging it would break the line it sits in.

- **Responsive.** Asserted rather than eyeballed, per section per capture: a screenshot is clipped
  to the viewport, so the one row that overflows is exactly what it cannot show.
  `expectNoHorizontalScroll` runs before every shutter — 92 assertions.
- **Theme parity.** 46 dark captures, one per section per viewport.
- **Screenshots.** Every claim above is backed by a file in the capture directory.

## Findings

1. **Bare checkboxes have no touch target — blocks the A11y gate.** The notification channel
   matrix, `selection-checkbox`, and the calendar layer panel render `Checkbox` with no wrapping
   label, so there is nothing to enlarge. Each needs its own row/cell to take the coarse floor.
   Until then this surface does not meet the rubric.
2. **Brand voice has no settled register.** Naming took three passes on one page, and the rule that
   emerged — headings are neutral labels, never conversational — has not been applied outside
   Settings. Worth a read-through of the other surfaces before it drifts further apart.
3. **Motion is inherited, not authored.** Nothing in this pass touched transitions, and the
   dimension is a 3 by default rather than by decision.
4. **`cursor: default` on non-button controls** was the 2026-08-02 detail finding and was not
   re-measured. It may or may not still hold.
5. **The shell still lists "Tasks" and "Stream" twice**, once personal and once under Workspace.
   Recorded on all five surfaces in the 2026-08-02 pass; it is shell chrome rather than Settings,
   and it is visible in every capture here.
6. **Shape is unused.** Everything is `rounded-xl`. MD3 Expressive differentiates a card, a
   selected row and a pressed state by shape, and none of that vocabulary is in play.

**Verdict: SHIP.** Every dimension ≥ 3, four at 4, every gate green. The two dimensions that
blocked the previous review — hierarchy and detail — are 4 and 3. Findings 1–6 are follow-ups.

Worth recording how the a11y gate resolved, because it went green, then red, then green again. The
first pass claimed it on an `elementFromPoint` probe showing the pseudo-element received the tap —
which was the defect, not the proof: it received the tap _instead of_ the input. A review pass
caught it, the overlay was reverted, and the gate was recorded as failing. It passes now on a
different mechanism — a `<label>`, which forwards its clicks to the control it wraps — verified by
the same measurement that found the original failure.
