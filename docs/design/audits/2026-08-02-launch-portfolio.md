---
surfaces: ['portfolio']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 2
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

# Design review: /portfolio (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** Four dimensions sit below the bar. The surface renders one 204px card in an
884px panel and offers the reader no action anywhere on the page.

Reviewed against `docs/design/craft-rubric.md` on the branch's dev stack, signed in as the local
review account, in the account's genuine empty state.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                           |
| ----------------- | ----------------------------------------------- |
| Standard shot set | `portfolio-{1440x900,390x844}-{light,dark}.png` |

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         | 3     | "Portfolio — Every venture on one timeline." is the product's thesis in six words, and "venture" is the right domain-neutral noun for a reader running companies, nonprofits and a personal life side by side. The empty state's "Nothing in flight" keeps the same register.                                                                                |
| 2. Typographic craft              | 3     | Measured: `h1` at 22px over a 14px subtitle, with the empty-state heading at 16px and its body at 14px. Two clear levels per region, no ad hoc sizes, no orphan at 390 (`portfolio-390x844-light.png`).                                                                                                                                                      |
| 3. Spatial rhythm & density       | 2     | Measured at 1440: the `main` panel is 760x884 at x=256; the only card ends at y=304 and the panel ends at y=892. **588px — 66% of the panel — is empty**, and nothing below the fold earns its position. Separately, the content inset here is 24px (content at x=280) against `/today`'s 40px (x=296) inside the identical panel box.                       |
| 4. Hierarchy & information design | 2     | Two problems. The page has **no primary action at all** — measured, the empty-state card contains zero `button` or `a` descendants — so the five-second test's "what do I do next" has no answer on the surface. And the shared sidebar lists "Stream" twice (personal and Workspace groups, same word, same icon) alongside Today/My Work and Inbox/Triage. |
| 5. Color discipline               | 3     | Neutral-first; the accent appears only on the active "Portfolio" nav row and the recovery-codes nudge link. `portfolio-1440x900-dark.png` re-tints rather than inverts, and the empty card still reads as a distinct surface in dark.                                                                                                                        |
| 6. Motion & feedback              | 3     | Keyboard `Tab` walks the shell and paints a visible focus ring at every stop reached (verified by capture on the shared frame). Nothing on the surface is dead-on-click, because nothing on the surface is clickable.                                                                                                                                        |
| 7. States completeness            | 2     | The empty state explains what the surface is and why it is empty, but it does not offer the one action to take next — measured, it contains no control. The rubric's standard for a level-3 empty state is explicitly "what this is, why it's empty, **the one action to take next**". Two of three.                                                         |
| 8. Detail craft (squint test)     | 2     | Measured: 28 visible controls, all enabled, of which **10** compute `cursor: default` — every `<button>` in the shell. Every `<a>` computes `pointer`. Separately, at 390 the fixed Athena launcher's centre sits over page content (`elementsFromPoint` returns the Portfolio content node beneath it).                                                     |

Gates: A11y ✅ (document overflow at 320/390/1440 = 0/0/0px; visible keyboard focus; no control
under the 40px mobile floor except the standard visually-hidden skip link at 18px; lowest measured
text contrast on the surface 5.01:1, above AA) · Responsive ✅ · Theme parity ✅ · No placeholder ✅
(the empty state is the account's real state, not staged data) · Screenshots ✅

## Findings (ordered by severity)

1. **The empty state has no action.** Measured: the "Nothing in flight" card's descendant control
   list is `[]`. A reader arriving at an empty Portfolio is told what would appear here and left
   with nowhere to click. Compare `/today`, whose empty state names two next moves in prose.

2. **588px of the 884px panel is empty.** The single card occupies y=100–304 and nothing follows.
   At 1440 the surface reads as a page that has not been laid out for its own empty state.

3. **The content inset disagrees with `/today`.** Both surfaces render into an identical `main` box
   (x=256, w=760, h=884). `/today` insets content to x=296 and starts at y=64; `/portfolio` insets
   to x=280 and starts at y=32. `/inbox` and `/search` match `/portfolio`; `/settings` uses x=295,
   y=40. Three different insets across five sibling surfaces in one shell is a system-level
   spacing finding, recorded on each of the five.

4. **Ten enabled buttons compute `cursor: default`.** One shared Button primitive, not ten
   mistakes — the same measurement reproduces on all five app surfaces reviewed in this pass.

## Not verified in this pass

Populated behaviour. Every capture is of the genuine empty account, so nothing here scores the
surface's loaded state, its overflow behaviour with many ventures, or its timeline rendering.
