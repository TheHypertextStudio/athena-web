---
surfaces: ['calendar-item-peek', 'calendar-item-drawer', 'event-arc']
date: 2026-09-06
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 4
  color: 3
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

# Design review: calendar event peek and detail — 2026-09-06

Screenshots: `screenshots/2026-09-06-calendar-event/` — 1440×900 light and dark for the peek, the
detail, the detail scrolled to its arc, and an event with nothing attached; 390×844 for the peek's
sheet; 320px for the overflow check.

Seeded through the running API on `dev-stack.sh`: one event with prep, agenda, follow-up and
outcome tasks plus a contained item and a scheduler-style debrief relation, and one bare event.

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                      |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | Calm Plex/MD3 throughout, no decoration. The seam sentence and the conflict copy are written rather than templated, and both name what Docket did instead of what failed.                                                                     |
| 2. Typographic craft      | 3     | Two levels in the masthead (`headline-small` title, `body-medium` when) and two in the body (`label-medium` band and property labels, `body-medium` values). Zero raw type utilities; the two files that carried them left the ledger.        |
| 3. Spatial rhythm         | 3     | One inset from `DialogHeader`/`DialogBody`/`DialogFooter` and one gap scale. The saved-place card sits alone between the provider fields and the arc with more air around it than either — the weakest measurement on the surface.            |
| 4. Hierarchy              | 4     | The five-second test now answers itself: what it is, when, then what surrounds it. One primary action. An event with nothing attached went from seven controls and two apology sentences to one affordance.                                   |
| 5. Color discipline       | 3     | Neutral apart from the layer colour and the error role. A layer with no colour of its own falls to `outline-variant`, so the peek's band is nearly invisible on native events — correct, but it means the colour moment only lands on Google. |
| 6. Motion & feedback      | 3     | Radix's own popover and dialog transitions; no bespoke motion. Save state is a live region, and every row's detach affordance appears on hover and focus without moving anything.                                                             |
| 7. States completeness    | 4     | Empty bands render nothing rather than an apology. Loading is two row-shaped skeletons. The conflict state is recoverable rather than a dead read-only badge, and the offline-queued link says so.                                            |
| 8. Detail craft           | 3     | Zero horizontal overflow at 320px, measured. The title wraps rather than clipping. Icons share one gutter axis across When, Where, Notes, Guests and Saved place.                                                                             |

Gates: A11y ✅ · Responsive ✅ (0px overflow at 320) · Theme parity ✅ · No placeholder ✅ ·
Screenshots ✅

## Findings

1. **The saved-place card is orphaned** — `calendar-item-workspace.tsx`. It is a lone one-row
   `Surface` between the provider fields and the first arc band, and it reads as a stray rather than
   as the first thing Docket adds. It probably belongs grouped with the arc, or inline with the
   other property rows and distinguished some other way.
2. **A colourless layer gets no colour moment** — `calendar-item-peek-overlay.tsx`. Docket-native
   layers have `color: null`, so the peek's band falls back to a hairline. Google events read
   correctly; native ones lose the tie back to the block they came from.
3. **Linking an existing task still asks for an id** —
   `item-drawer/task-forms.tsx`. Out of scope here: a picker needs a `calendar-item.task` relation
   definition in the work domain and a new picker request kind.

Verdict: SHIP. Every dimension is at or above the bar and every gate is green. Findings 1 and 2 are
craft debt worth a follow-up, not blockers.
