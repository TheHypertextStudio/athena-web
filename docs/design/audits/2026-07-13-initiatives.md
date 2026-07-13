# Design review: Initiatives experience — 2026-07-13

Screenshots:

- `screenshots/2026-07-13-initiatives-overview-desktop-light.png` — 1440×900, light
- `screenshots/2026-07-13-initiatives-overview-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-07-13-initiatives-overview-mobile-light.png` — 390×844, light
- `screenshots/2026-07-13-initiatives-overview-mobile-dark.png` — 390×844, dark
- `screenshots/2026-07-13-initiative-detail-desktop-light.png` — 1440×900, light
- `screenshots/2026-07-13-initiative-detail-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-07-13-initiative-detail-mobile-light.png` — 390×844, light
- `screenshots/2026-07-13-initiative-detail-mobile-dark.png` — 390×844, dark

Register: app — calm, dense, keyboard-first Plex/MD3.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | Both overview screenshots use Docket's neutral app register, semantic health color, vocabulary-resolved Initiative copy, and organization-specific transit language. The detail reads as a strategic brief instead of a generic dashboard card.                                                                                  |
| 2. Typographic craft              |     3 | The overview uses the named `text-h1` scale and a restrained body/xs hierarchy. The detail's deliberately larger, tightly tracked title establishes the requested printable-object character while the document settles into a readable prose measure.                                                                           |
| 3. Spatial rhythm & density       |     3 | Desktop rows align to shared column edges with 12px vertical padding; mobile rows reflow into a consistent title, summary, and metadata rhythm. The attention band, filters, roster, latest update, document, and rail all use clear separator-based grouping.                                                                   |
| 4. Hierarchy & information design |     4 | In five seconds the overview exposes the primary action, the single most actionable risk, and the strategic hierarchy. The detail makes the Initiative itself primary, then orders latest update, permanent brief, sub-initiatives, connected work, and editable properties by executive relevance.                              |
| 5. Color discipline               |     3 | Light and dark screenshots remain overwhelmingly neutral. Color is reserved for health, selection, focus, and the primary creation action; components use semantic tokens rather than hardcoded values.                                                                                                                          |
| 6. Motion & feedback              |     3 | Interactive rows and links have hover/focus feedback, mutations use optimistic updates with rollback, and loading uses shape-matched skeletons. The surface adds no decorative motion and remains understandable without animation.                                                                                              |
| 7. States completeness            |     3 | The implementation includes hierarchy-aware filtering, collapsed descendants, attention-empty copy, roster empty/loading/error states, aggregate loading/error states, editable property failures, resource failures, and long mobile titles. Seeded review data exercises risk, stale update, hierarchy, and document overflow. |
| 8. Detail craft                   |     3 | At 390px the hierarchy sheds desktop columns into compact metadata with no clipped titles; at 320px the measured document width and viewport width are both 320px. Separators, badges, TOC indentation, date alignment, and the bounded latest update remain coherent in both themes.                                            |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: semantic table, navigation, tab, heading, and form structures are present; controls have accessible labels; mobile controls touched in the primary flow are at least 40px; keyboard focus on the “All initiatives” link produced a visible 1px amber outline.
- **Responsive**: browser measurements at 390px and 320px returned `scrollWidth === innerWidth`; desktop columns shed into mobile metadata rather than requiring horizontal scrolling.
- **Theme parity**: both surfaces were captured in light and dark with seeded content.
- **No placeholder**: all visible copy and controls are backed by working Initiative data or explicit empty/loading states.
- **Screenshot-verified**: the eight standard screenshots above cover both routes, widths, and themes; browser console errors were empty.

## Findings resolved during review

1. **Mobile roster rendered as a clipped desktop table.** The fixed 760px minimum width forced summaries and columns off-screen. The roster now preserves table semantics on desktop and sheds owner/target columns into a compact mobile hierarchy row. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
2. **Several primary mobile controls were below the 40px touch target.** Filters, hierarchy toggles, detail tabs, labels, resource controls, and top actions now have 40px minimum targets at narrow widths. — `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`, `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`, `apps/web/src/components/initiatives/initiative-document.tsx`

Verdict: **SHIP** — all dimensions meet the craft bar and all hard gates are green.
