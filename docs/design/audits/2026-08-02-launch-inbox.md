---
surfaces: ['inbox']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 2
  color: 3
  motion: 3
  states: 2
  detail: 2
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /inbox (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** Hierarchy, states, and detail craft are below the bar. This surface carries
the worst cursor-affordance count of the five app surfaces reviewed in this pass: 17 of 35 controls.

Reviewed against `docs/design/craft-rubric.md` on the branch's dev stack, signed in as the local
review account, in the account's genuine empty state.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                       |
| ----------------- | ------------------------------------------- |
| Standard shot set | `inbox-{1440x900,390x844}-{light,dark}.png` |

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | "Inbox — Everything that needs a response." states the surface's contract in five words, and the six filters (All, Unread, Needs action, Announcements, Mentions & assignments, Activity) are named for what a reader wants rather than for the data model. "Inbox zero" as the empty-state heading is confident and specific.                                                         |
| 2. Typographic craft              | 3     | Measured: `h1` at 22px over a 14px subtitle; filter labels at 14px; empty-state heading 16px over 14px body. "Mentions & assignments" — the longest filter label — does not wrap or truncate at 1440, and the whole strip reflows without clipping at 390 (`inbox-390x844-light.png`).                                                                                                 |
| 3. Spatial rhythm & density       | 3     | One rhythm, measured. Inside `main` (760x884 at x=256) content insets to x=280; the header, filter strip, and empty-state card sit at y=32/104/172 with heights 48/44/198, giving 24px between header and filters and 24px between filters and content. Consistent 24px vocabulary.                                                                                                    |
| 4. Hierarchy & information design | 2     | The filter strip is the right primary affordance and it leads. But the shared sidebar lists **"Stream" twice** — once personal, once under "Workspace", identical word and icon — and offers Inbox alongside a separate "Triage" destination. A surface whose whole job is "everything that needs a response" is framed by a nav that names two other places the same work could live. |
| 5. Color discipline               | 3     | Neutral-first. The accent is spent on the active nav row, the selected filter, and the recovery-codes nudge link — nothing decorative. `inbox-1440x900-dark.png` re-tints the filter strip and empty card so both still read as distinct surfaces in dark.                                                                                                                             |
| 6. Motion & feedback              | 3     | Keyboard `Tab` paints a visible focus ring at each stop reached. The six filters are real controls that switch the list, not decoration.                                                                                                                                                                                                                                               |
| 7. States completeness            | 2     | Measured: the surface renders **two** empty states — "Inbox zero — No approvals, mentions, or assignments need your response right now." and "Nothing yet — Activity will show up here as work happens." — and **both contain zero controls**. Each explains; neither offers the next action. The rubric's level-3 standard requires all three.                                        |
| 8. Detail craft (squint test)     | 2     | Measured: 35 visible controls, all enabled, of which **17** compute `cursor: default` — including all six filters, which are the surface's primary affordance. Every `<a>` computes `pointer`. At 390 the fixed Athena launcher's centre sits over the filter strip (`elementsFromPoint` returns the Inbox content node beneath it).                                                   |

Gates: A11y ✅ (document overflow at 320/390/1440 = 0/0/0px; visible keyboard focus; no control
under the 40px mobile floor except the standard visually-hidden skip link at 18px; lowest measured
text contrast 5.01:1, above AA) · Responsive ✅ · Theme parity ✅ · No placeholder ✅ (both empty
states are the account's real state) · Screenshots ✅

## Findings (ordered by severity)

1. **All six filters compute `cursor: default`.** The filter strip is the primary affordance on
   this surface and none of its controls signals that it is clickable. This is the shared Button
   primitive: 17 of 35 enabled controls here, and every `<a>` on the same page is `pointer`.

2. **Both empty states are actionless.** Measured control lists: `[]` and `[]`. "Inbox zero" is a
   good sentence; it needs somewhere to go next.

3. **522px of the 884px panel is empty.** Content ends at y=370. As with `/portfolio`, the surface
   has not been composed for its own empty state.

4. **The floating Athena launcher covers the filter strip at 390px**, with no reserved gutter.

## Not verified in this pass

Populated behaviour: every capture is of the genuine empty account, so nothing here scores row
density, overflow with long titles, unread treatment, or the filters' loaded states.
