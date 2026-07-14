# Design review: Initiatives experience — 2026-07-13

Revised screenshots:

- `screenshots/2026-07-13-initiatives-overview-scrollable-desktop-light.png` — 1440×900, light
- `screenshots/2026-07-13-initiatives-overview-scrollable-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-07-13-initiatives-overview-scrollable-medium-light.png` — 1000×800, light
- `screenshots/2026-07-13-initiatives-overview-scrollable-mobile-light.png` — 390×844, light
- `screenshots/2026-07-13-initiatives-overview-scrollable-mobile-dark.png` — 390×844, dark
- `screenshots/2026-07-13-initiative-detail-revised-desktop-light.png` — 1440×900, light
- `screenshots/2026-07-13-initiative-detail-revised-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-07-13-initiative-detail-revised-mobile-light.png` — 390×844, light
- `screenshots/2026-07-13-initiative-detail-revised-mobile-dark.png` — 390×844, dark
- `screenshots/2026-07-13-initiative-detail-print-from-updates.png` — print media from Updates tab

Register: app — calm, dense, keyboard-first Plex/MD3.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | Both overview screenshots use Docket's neutral app register, semantic health color, vocabulary-resolved Initiative copy, and organization-specific transit language. The detail reads as a strategic brief instead of a generic dashboard card.                                                                                  |
| 2. Typographic craft              |     3 | The overview uses the named `text-h1` scale and plain sentence-case labels. The detail title uses the named `text-document-title` token, fluid from 32px to a 56px cap, with status above it; the permanent document settles into a readable prose measure.                                                                      |
| 3. Spatial rhythm & density       |     3 | The attention item is one quiet tonal surface with narrative content above a dedicated action/pager footer. Initiative rows reserve one title line and two description lines for consistent height; the complete table remains available from medium widths onward.                                                              |
| 4. Hierarchy & information design |     4 | In five seconds the overview exposes the primary action, the single most actionable risk, and the strategic hierarchy. The detail makes the Initiative itself primary, then orders latest update, permanent brief, sub-initiatives, connected work, and editable properties by executive relevance.                              |
| 5. Color discipline               |     3 | Light and dark screenshots remain overwhelmingly neutral. Color is reserved for health, selection, focus, and the primary creation action; components use semantic tokens rather than hardcoded values.                                                                                                                          |
| 6. Motion & feedback              |     3 | Interactive rows and links have hover/focus feedback, mutations use optimistic updates with rollback, and loading uses shape-matched skeletons. The surface adds no decorative motion and remains understandable without animation.                                                                                              |
| 7. States completeness            |     3 | The implementation includes hierarchy-aware filtering, collapsed descendants, attention-empty copy, roster empty/loading/error states, aggregate loading/error states, editable property failures, resource failures, and long mobile titles. Seeded review data exercises risk, stale update, hierarchy, and document overflow. |
| 8. Detail craft                   |     3 | At the constrained desktop layout the 896px table scrolls inside a 766px roster region while the 1440px page itself does not overflow. At 390px the hierarchy uses compact metadata; at 320px `scrollWidth === innerWidth`. Attention controls remain aligned in a dedicated footer at every width.                              |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: semantic navigation, region, table, tab, heading, and form structures are present; controls have accessible labels; mobile controls touched in the primary flow are at least 40px; keyboard tabbing produced the shared visible 2px focus ring on the skip link.
- **Responsive**: at the constrained desktop layout the roster measured `scrollWidth: 896`, `clientWidth: 766`, and `overflow-x: auto`, while the page remained exactly 1440px wide. At 320px the page returned `scrollWidth === innerWidth`.
- **Theme parity**: both surfaces were captured in light and dark with seeded content.
- **No placeholder**: all visible copy and controls are backed by working Initiative data or explicit empty/loading states.
- **Screenshot-verified**: the eight standard screenshots above cover both routes, widths, and themes; browser console errors were empty.
- **Print state**: print-media emulation from the Updates tab still renders the permanent document, latest update, hierarchy, connected work, and a static property summary while removing editors and app chrome.

## Findings resolved during review

1. **Medium-width correction hid the established columns.** The complete six-column table now appears at `@2xl` with a 56rem minimum width and scrolls inside its roster region when the content pane is narrower. Mobile alone uses compact metadata. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
2. **Attention content and controls formed one toolbar-like row.** Narrative content now remains above a stable footer with the action on the left and pagination on the right at every width. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
3. **Initiative row heights varied with summary length.** Titles clamp to one line and every row reserves a two-line description block, producing a consistent hierarchy rhythm without suppressing useful summary copy. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
4. **Initiative title scale and label styling fought the document hierarchy.** Status now precedes a named 32–56px document title, and semantic labels use ordinary sentence-case typography rather than all-caps overlines. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`, `packages/ui/src/styles/globals.css`

Verdict: **SHIP** — all dimensions meet the craft bar and all hard gates are green.
