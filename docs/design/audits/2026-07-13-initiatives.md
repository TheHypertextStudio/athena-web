# Design review: Initiatives experience — 2026-07-13

Revised screenshots:

- `screenshots/2026-07-13-initiatives-overview-revised-desktop-light.png` — 1440×900, light
- `screenshots/2026-07-13-initiatives-overview-revised-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-07-13-initiatives-overview-revised-intermediate-light.png` — 1000×800, light
- `screenshots/2026-07-13-initiatives-overview-revised-mobile-light.png` — 390×844, light
- `screenshots/2026-07-13-initiatives-overview-revised-mobile-dark.png` — 390×844, dark
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
| 3. Spatial rhythm & density       |     3 | The attention item is one quiet tonal surface, with its action and pager aligned as one trailing group or one justified footer. The roster uses a consistent title, summary, and wrapping metadata rhythm until the full six-column table has enough container width.                                                            |
| 4. Hierarchy & information design |     4 | In five seconds the overview exposes the primary action, the single most actionable risk, and the strategic hierarchy. The detail makes the Initiative itself primary, then orders latest update, permanent brief, sub-initiatives, connected work, and editable properties by executive relevance.                              |
| 5. Color discipline               |     3 | Light and dark screenshots remain overwhelmingly neutral. Color is reserved for health, selection, focus, and the primary creation action; components use semantic tokens rather than hardcoded values.                                                                                                                          |
| 6. Motion & feedback              |     3 | Interactive rows and links have hover/focus feedback, mutations use optimistic updates with rollback, and loading uses shape-matched skeletons. The surface adds no decorative motion and remains understandable without animation.                                                                                              |
| 7. States completeness            |     3 | The implementation includes hierarchy-aware filtering, collapsed descendants, attention-empty copy, roster empty/loading/error states, aggregate loading/error states, editable property failures, resource failures, and long mobile titles. Seeded review data exercises risk, stale update, hierarchy, and document overflow. |
| 8. Detail craft                   |     3 | The reported 1000px intermediate state keeps attention controls aligned and avoids narrow metadata columns. At 390px the hierarchy uses compact metadata with no clipped titles; at 320px `scrollWidth === innerWidth`. Badges, TOC indentation, dates, and latest-update emphasis remain coherent in both themes.               |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: semantic navigation, region, table, tab, heading, and form structures are present; controls have accessible labels; mobile controls touched in the primary flow are at least 40px; keyboard tabbing produced the shared visible 2px focus ring on the skip link.
- **Responsive**: browser measurements at 320px returned `scrollWidth === innerWidth`; the 1000px screenshot verifies the exact intermediate layout where the old table and attention controls broke down.
- **Theme parity**: both surfaces were captured in light and dark with seeded content.
- **No placeholder**: all visible copy and controls are backed by working Initiative data or explicit empty/loading states.
- **Screenshot-verified**: the eight standard screenshots above cover both routes, widths, and themes; browser console errors were empty.
- **Print state**: print-media emulation from the Updates tab still renders the permanent document, latest update, hierarchy, connected work, and a static property summary while removing editors and app chrome.

## Findings resolved during review

1. **Intermediate roster columns wrapped into unreadable fragments.** The full table appeared before the content container had room for six columns. It now waits for the `@5xl` container breakpoint; every narrower row retains status, health, owner, target, and last update as wrapping metadata. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
2. **Attention controls split into unrelated rows.** The action and pager now share one control group inside a single borderless tonal surface, appearing as a trailing cluster when wide and a justified footer when narrow. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
3. **Initiative title scale and label styling fought the document hierarchy.** Status now precedes a named 32–56px document title, and semantic labels use ordinary sentence-case typography rather than all-caps overlines. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`, `packages/ui/src/styles/globals.css`

Verdict: **SHIP** — all dimensions meet the craft bar and all hard gates are green.
