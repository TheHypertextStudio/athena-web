# Design review: Initiatives experience — 2026-07-13

Final roster screenshots (real API-backed LVBT fixture):

- `screenshots/final-initiative-roster/orgs-orgId-initiatives-1440x900-light.png` — 1440×900, light
- `screenshots/final-initiative-roster/orgs-orgId-initiatives-1440x900-dark.png` — 1440×900, dark
- `screenshots/final-initiative-roster/orgs-orgId-initiatives-390x844-light.png` — 390×844, light
- `screenshots/final-initiative-roster/orgs-orgId-initiatives-390x844-dark.png` — 390×844, dark
- `screenshots/final-initiative-roster/initiative-icon-picker-search.png` — anchored picker filtered to transit icons

Earlier detail and responsive evidence:

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

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         |     3 | Both overview screenshots use Docket's neutral app register, semantic health color, vocabulary-resolved Initiative copy, and organization-specific transit language. The detail reads as a strategic brief instead of a generic dashboard card.                                                                                                        |
| 2. Typographic craft              |     3 | The overview uses the named `text-page-title` scale and plain sentence-case labels. The detail title uses the named `text-document-title` token, fluid from 32px to a 56px cap, with status above it; the permanent document settles into a readable prose measure.                                                                                    |
| 3. Spatial rhythm & density       |     3 | The attention item is one quiet tonal surface with narrative content above a dedicated action/pager footer. Every Initiative row is exactly 72px; summaries wrap to at most two lines, while summary-less rows center their icon and title without a phantom gap.                                                                                      |
| 4. Hierarchy & information design |     4 | In five seconds the overview exposes the primary action, the single most actionable risk, and the strategic hierarchy. The detail makes the Initiative itself primary, then orders latest update, permanent brief, sub-initiatives, connected work, and editable properties by executive relevance.                                                    |
| 5. Color discipline               |     3 | Light and dark screenshots remain overwhelmingly neutral. Color is reserved for health, selection, focus, and the primary creation action; components use semantic tokens rather than hardcoded values.                                                                                                                                                |
| 6. Motion & feedback              |     3 | Interactive rows and links have hover/focus feedback, mutations use optimistic updates with rollback, and loading uses shape-matched skeletons. The surface adds no decorative motion and remains understandable without animation.                                                                                                                    |
| 7. States completeness            |     3 | The implementation includes hierarchy-aware filtering, attention-empty copy, roster empty/loading/error states, aggregate loading/error states, optimistic picker rollback, editable property failures, resource failures, and long titles. Seeded review data exercises risk, stale updates, hierarchy, missing summaries, and bounded two-line copy. |
| 8. Detail craft                   |     3 | The 896px roster scrolls inside its own region while the page itself remains viewport-bound. Runtime measurements confirm 72px rows, 40px icon targets, and 32px circular glyph fields. Curved 2px hierarchy rails stop short of the icon fields, metadata stays inset, and restrained hover tone replaces row rules.                                  |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: semantic navigation, region, table, tab, heading, and form structures are present; controls have accessible labels; mobile controls touched in the primary flow are at least 40px; keyboard tabbing produced the shared visible 2px focus ring on the skip link.
- **Responsive**: the final API-backed roster measured `scrollWidth: 896` inside its local overflow region while the 1440px page remained viewport-bound. At 390px the same complete roster scrolls horizontally rather than dropping columns.
- **Theme parity**: both surfaces were captured in light and dark with seeded content.
- **No placeholder**: all visible copy and controls are backed by working Initiative data or explicit empty/loading states.
- **Screenshot-verified**: the final overview set covers both standard widths and themes, plus the real searchable picker; the earlier detail set covers both widths and themes.
- **Print state**: print-media emulation from the Updates tab still renders the permanent document, latest update, hierarchy, connected work, and a static property summary while removing editors and app chrome.

## Findings resolved during review

1. **Medium-width correction hid the established columns.** The complete six-column table now appears at `@2xl` with a 56rem minimum width and scrolls inside its roster region when the content pane is narrower. Mobile alone uses compact metadata. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
2. **Attention content and controls formed one toolbar-like row.** Narrative content now remains above a stable footer with the action on the left and pagination on the right at every width. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
3. **Initiative row heights varied with summary length.** Titles clamp to one line and every row reserves a two-line description block, producing a consistent hierarchy rhythm without suppressing useful summary copy. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
4. **Initiative title scale and label styling fought the document hierarchy.** Status now precedes a named 32–56px document title, and semantic labels use ordinary sentence-case typography rather than all-caps overlines. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`, `packages/ui/src/styles/globals.css`
5. **Disclosure controls competed with Initiative identity.** The hierarchy is now always visible and uses rounded, curved connector rails with breathing room around a consistent circular icon field. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
6. **The original icon picker was too small and shallow.** The generic display catalog now exposes 51 stable keys backed by rounded Material icons; the anchored picker adds search, a dense grid, and consistent 40px targets without coupling presentation to Initiative domain data. — `packages/types/src/entity-display.ts`, `packages/ui/src/icons/strategic-work-rounded.ts`, `apps/web/src/components/initiatives/initiative-icon-picker.tsx`

Verdict: **SHIP** — all dimensions meet the craft bar and all hard gates are green.
