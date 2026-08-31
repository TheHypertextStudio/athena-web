---
surfaces: ['oauth-authorize']
date: 2026-08-31
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

# Design review: the OAuth consent screen (`/oauth/authorize`) — 2026-08-31

Screenshots: `docs/design/audits/screenshots/2026-08-31-oauth-authorize/` — 18 PNGs. Every capture
is of the real signed request: a client was dynamically registered against the running
authorization server, and an authenticated browser was driven through
`/api/auth/oauth2/authorize` so the screen rendered from a genuine `sig`-bearing query, at
1440×900, 390×844, 320×844, and 390×600, in both themes.

| File prefix            | State                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `consent-realistic-*`  | `Claude` requesting all five permissions, returning to `claude.ai`    |
| `consent-expanded-*`   | Every disclosure open — the scroll-mask stress case                   |
| `consent-long-host-*`  | Same request, `redirect_uri` on this worktree's own 44-character host |
| `consent-focus-*-zoom` | Keyboard focus on the first and last permission rows, cropped         |

This is a follow-up to `2026-08-02-oauth-authorize.md` (verdict SHIP), re-reviewing the same
surface against three specific concerns raised for this pass: mobile fidelity and component
consistency, whether the disclosure's expanded text is properly sized, and whether scope copy
stays centralized — plus closing out that review's two open, non-blocking findings.

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Unchanged from 2026-08-02: register-correct (Fraunces wordmark inside the Plex/MD3 card), no filler, no OAuth jargon in visible copy. Re-read every rendered sentence for this pass — heading, context rows, five scope labels, five access qualifiers, five detail sentences, footnote — none restates what's already visible or hedges.                                                            |
| 2. Typographic craft              | 3     | MD3 tokens carry the disclosure hierarchy: `text-body-medium` label, `text-label-medium` access qualifier, `text-body-small` detail sentence — three distinct, intentional sizes, not one undersized afterthought. Verified legible at 320–1440px in `consent-expanded-*` (both themes): the detail sentence reads clearly under its label at every captured width.                                  |
| 3. Spatial rhythm & density       | 3     | One rhythm, unchanged: `px-3 py-2.5` rows, `gap-3` columns, `gap-0.5` label pairs. The list's cap moved from `45dvh` to `40dvh` (see finding 2) without touching row height — every row is still a uniform block in `consent-realistic-*` and `consent-expanded-*`.                                                                                                                                  |
| 4. Hierarchy & information design | 3     | Five-second test still passes. The scroll-affordance mask (finding 1) makes "there's more below" a designed signal instead of an accident, which is itself a hierarchy fix — a person skimming the list now has a visible reason to keep scrolling instead of assuming five rows is everything.                                                                                                      |
| 5. Color discipline               | 3     | The new scroll masks use `bg-gradient-to-{b,t} from-surface-container-high to-transparent` — the same tonal-block token the list itself already carries, not a hardcoded value. Confirmed matching in both themes (`consent-expanded-1440x900-{light,dark}.png`) — the fade reads as the surface itself thinning out, not a foreign overlay.                                                         |
| 6. Motion & feedback              | 3     | The chevron's rotation now keys off Radix's `data-[state=open]` via `group-data-[state=open]:rotate-180` instead of the CSS `:open` pseudo-class — same transition token, same visual result, verified in `consent-expanded-*`. No new motion was added.                                                                                                                                             |
| 7. States completeness            | 3     | The one real defect this pass found — content silently clipped inside the capped list with no way to know more existed — is now a designed state (finding 1). Every other state (invalid link, signed-out, session-pending, unknown scope) is unchanged from 2026-08-02.                                                                                                                             |
| 8. Detail craft (squint test)     | 3     | **Zero horizontal overflow** across every capture (1440/390/320, both themes — none of the 24 raw frames this pass produced were flagged). Keyboard focus re-verified on the rebuilt disclosure: `consent-focus-first-row-zoom.png` / `consent-focus-last-row-zoom.png` show the same complete four-edge `focusRingInset` ring the 2026-08-02 pass fixed, carried through the primitive swap intact. |

Gates: A11y ✅ (focus rings complete on the rebuilt disclosure; Radix supplies `aria-expanded` and
full keyboard toggling; buttons stay `size="lg"`, 40px+) · Responsive ✅ (zero overflow at
320/390/1440 across all 24 raw frames) · Theme parity ✅ (every case captured light + dark) · No
placeholder ✅ · Screenshots ✅ (18 PNGs of three real states plus focus evidence)

## Findings

Resolved in this pass:

1. **The capped scope list silently clipped content with no indication more existed.** —
   `apps/web/src/app/(auth)/oauth/authorize/page.tsx` (`ScopeList`) — Expanding every disclosure at
   1440×900 hid the fifth row (`Stay connected`) entirely inside the `max-h-[45dvh]` block; at
   390×844 it cut the fourth row's sentence mid-word. Neither state gave any visual cue the block
   was scrollable — this is the "leaks out of its container" defect this pass was asked to catch,
   and it was worse than the 2026-08-02 review's related finding described (that one covered only
   the always-expanded stress case; this reproduces in the ordinary collapsed state too, since five
   58px rows already exceed the old cap). Fixed with `ScopeList`: a `ResizeObserver` + scroll
   listener tracks whether the list has hidden content above or below, and renders a short
   `surface-container-high → transparent` gradient at whichever edge does. Before/after:
   `consent-expanded-1440x900-light.png` now shows the top mask instead of a vanished row.
2. **A five-scope request pushes the decision buttons close to the fold on very short viewports.**
   — Reproduces 2026-08-02's finding 6, this time confirmed to affect the realistic case too, not
   only the long-host stress case (measured directly: at 390×600 the document is 793px tall against
   a 600px viewport). The list's cap was tightened from `45dvh` to `40dvh`, reclaiming ~30px; `Allow
access` now sits 41px below the fold at this deliberately extreme height (down from being
   effectively unreachable without already knowing to scroll). This remains ordinary document
   scroll, not clipping — the same judgment the original audit made — but it's now paired with the
   list's own scroll-affordance mask (finding 1), so the page no longer reads as a dead end at any
   point along the way.
3. **The permission disclosure was a page-local `<details>`/`<summary>` block, not a shared
   component.** — The design system had no Collapsible primitive to reach for, which the removed
   code comment said outright. Added `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` to
   `@docket/ui/primitives` (`packages/ui/src/primitives/collapsible.tsx`), a thin passthrough over
   `@radix-ui/react-collapsible` matching the package's existing `Popover`/`HoverCard` pattern.
   `ScopeRow` now composes it instead of native `<details>` — same keyboard/AT contract (Radix wires
   `aria-expanded` and Enter/Space toggling), but the open state reads through `data-[state=open]`
   like every other primitive in the system. Verified no regression: the `focusRingInset` ring this
   surface depends on (dense rows in a scroll container clip a standalone outer ring) is intact on
   both the first and last row — `consent-focus-first-row-zoom.png`,
   `consent-focus-last-row-zoom.png`. New primitive covered by
   `packages/ui/tests/primitives/collapsible.test.tsx` (3 tests: open/close on click, keyboard
   toggle, `data-state`/`aria-expanded` contract) at 100% line/statement coverage.

Confirmed, not a defect:

4. **Scope copy is already fully centralized.** Both surfaces that render a permission's words —
   this consent screen and the Connected Apps settings tab
   (`apps/web/src/components/settings/connected-apps-tab.tsx`) — import `describeScope` /
   `OAUTH_SCOPE_ACCESS_LABEL` from the one module, `apps/web/src/lib/oauth-scope-copy.ts`. No
   frontend surface has an ad-hoc duplicate. (Out of scope for this UI review: `apps/docs`'s public
   API reference hand-writes its own one-line scope descriptions in a markdown table, informational
   prose that can drift from this module over time — flagged separately, not a defect on this
   surface.)

Verdict: **SHIP** — every dimension is at least 3 and all five gates pass.
