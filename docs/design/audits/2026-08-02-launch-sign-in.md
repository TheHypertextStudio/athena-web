---
surfaces: ['sign-in']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /sign-in (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** Every gate is green and seven dimensions clear the bar. Detail craft does
not: the one primary action on the surface computes `cursor: default` while both subordinate links
compute `pointer`.

Reviewed against `docs/design/craft-rubric.md`. Every claim below is tied to a capture in the
evidence index or to a number printed by a probe run against the live dev stack; nothing is scored
from source reading.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                                   |
| ----------------- | ------------------------------------------------------- |
| Standard shot set | `sign-in-{1440x900,390x844}-{light,dark}.png`           |
| Failure state     | `sign-in-passkey-failure-1440x900-light.png`            |
| Keyboard focus    | `focus-today-tab4.png` (shell focus ring, shared frame) |

Captured unauthenticated with a fresh cookie-less Chromium context. `apps/web/e2e/tools/capture-shots.ts`
refuses any route whose final URL contains `/sign-in` — it reads that as an expired session — so this
one surface was captured with a purpose-built context instead of the shared harness.

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The Fraunces `Docket` wordmark is the only marketing-register element and it sits above a Plex-set card of app-register controls — the honest seam the rubric asks for, deliberately composed rather than accidental. Copy is specific and short: "Welcome back" / "Sign in to your Docket workspace." No filler, no jargon.                                                                                              |
| 2. Typographic craft              | 3     | Two levels plus the serif wordmark: 32px headline, 16px body, 14px link text. `sign-in-390x844-dark.png` shows "Welcome back" on one line with no orphan at 390, and the two link sentences wrap cleanly. Nothing ad hoc.                                                                                                                                                                                                 |
| 3. Spatial rhythm & density       | 3     | Measured at 1440: the card is 768x384 at x=336, y=258 — exactly viewport-centred on both axes. Two content columns start at x=377 and x=691, giving a 41px inner gutter. Vertical padding inside the card is ~112px, roughly 2.7x the horizontal, which reads as an intentionally calm auth composition rather than leftover space.                                                                                       |
| 4. Hierarchy & information design | 3     | The five-second test passes: one primary action ("Sign in with a passkey", 40px tall), two subordinate text links, nothing else competing. Recovery is offered before account creation, which matches the priority of a returning user on a sign-in page.                                                                                                                                                                 |
| 5. Color discipline               | 3     | Neutral card on a tinted canvas; the single accent carries the primary action and both links and nothing else. `sign-in-1440x900-dark.png` is re-tinted rather than inverted — the card still reads as a raised surface against the dark canvas. Lowest measured text contrast on the surface is well clear of AA.                                                                                                        |
| 6. Motion & feedback              | 3     | Two `Tab` presses land on the primary button and it matches `:focus-visible` with a painted ring (its computed box-shadow gains an opaque fourth layer, `lab(41.7 22.5 -73.9)`). Pressing the action produces feedback rather than silence — see states.                                                                                                                                                                  |
| 7. States completeness            | 3     | The failure state was exercised, not inferred. Clicking the primary action in a browser with no authenticator renders `sign-in-passkey-failure-1440x900-light.png`: a `role="alert"` live region reading "Could not sign in with that passkey. Please try again.", application-owned copy with no provider or exception text, and the primary action stays available for retry. Console errors on the failure path: zero. |
| 8. Detail craft (squint test)     | 2     | The primary action is an **enabled** `<button>` whose computed cursor is `default`; the wordmark and both links compute `pointer`. The rubric names `pointer` on buttons explicitly. Horizontal overflow at 320px is 0px.                                                                                                                                                                                                 |

Gates: A11y ✅ (0px overflow at 320; visible keyboard focus ring on the primary action; 40px primary
control; `role="alert"` error announcement) · Responsive ✅ (0px document overflow at 320, 390 and 1440) · Theme parity ✅ (light and dark captured at both widths) · No placeholder ✅ (no TODO copy,
no dead control — the one button performs a real WebAuthn ceremony and reports its failure) ·
Screenshots ✅

## Findings (ordered by severity)

1. **The primary action has no pointer cursor.** Measured on the live surface with the control
   enabled: `{"tag":"BUTTON","text":"Sign in with a passkey","cursor":"default","disabled":false}`,
   against `{"tag":"A","text":"Recover your account","cursor":"pointer"}`. This is not local to
   `/sign-in` — the same probe finds every enabled `<button>` in the app computing `cursor: default`
   (11 of 29 enabled controls on `/today`, 17 of 35 on `/inbox`). It is one defect in the shared
   Button primitive, not six.

2. **Two inline links measure 18px tall at narrow widths.** "Recover your account" and "Create an
   account" are 18px at 320px. They are inline links inside a sentence rather than standalone
   controls, so they are not counted against the 40px touch-target floor here; the measurement is
   recorded so a later pass does not have to re-derive it.

## Not verified in this pass

Hover and active treatments, transition token usage, and `prefers-reduced-motion` were not
exercised. The motion score above rests only on the keyboard focus ring and the observed failure
feedback.
