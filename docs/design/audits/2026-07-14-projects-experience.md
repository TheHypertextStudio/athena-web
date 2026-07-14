# Design review: Projects experience — 2026-07-14

Screenshots:

- `screenshots/projects-experience/overview-desktop-light.png`
- `screenshots/projects-experience/overview-desktop-dark.png`
- `screenshots/projects-experience/overview-mobile-light.png`
- `screenshots/projects-experience/overview-mobile-dark.png`
- `screenshots/projects-experience/detail-desktop-light.png`
- `screenshots/projects-experience/detail-desktop-dark.png`
- `screenshots/projects-experience/detail-mobile-light.png`
- `screenshots/projects-experience/detail-mobile-dark.png`
- `screenshots/projects-experience/dependencies-desktop-light.png`
- `screenshots/projects-experience/timeline-desktop-light.png`

Register: app — calm, dense, keyboard-first Plex/MD3. The captures use a real local account and
user-authorized Las Vegans for Better Transit sample Projects created through authenticated APIs;
the sample records are not shipped as product fixtures.

| Dimension                         | Score | Evidence                                                                                                                                                                                  |
| --------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | The strong Projects title, direct operating copy, rounded MD3 glyphs, and absence of decorative totals preserve Docket's visual and verbal register.                                      |
| 2. Typographic craft              |     3 | Overview uses the named page-title scale; detail uses the named 32–56px document-title scale. Summaries remain subordinate and roster descriptions clamp to two lines.                    |
| 3. Spatial rhythm & density       |     3 | The roster keeps stable 72px rows and padded columns; detail groups identity, summary, people, health, target, tabs, update, and document without a metadata wall.                        |
| 4. Hierarchy & information design |     3 | List, dependency, and timeline are equal lenses over one working set. Project identity and outcome precede secondary properties; Resources are a dedicated tab.                           |
| 5. Color discipline               |     3 | Semantic health and display colors carry meaning while tonal containers provide grouping in both themes without relying on divider lines.                                                 |
| 6. Motion & feedback              |     3 | Lens switches, rows, graph nodes, icon customization, tabs, and property mutations retain visible hover/focus/pending feedback without decorative motion.                                 |
| 7. States completeness            |     3 | Loading/error/empty states remain typed; populated list, dependency, timeline, document, update, task, resource, editable, and read-only paths are implemented.                           |
| 8. Detail craft                   |     3 | Customized glyphs, curved graph edges, bounded latest-update emphasis, two-line summaries, compact participant chips, and the anchored Project-info disclosure are consistently finished. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: lenses, rows, graph nodes, tabs, icon customization, and property controls use semantic
  controls and accessible names. Icon-only controls authored in this surface use 40px targets.
- **Responsive**: runtime checks at 320px report `scrollWidth === innerWidth`; dense tables and
  timelines scroll locally, tabs scroll horizontally, and the Project-info popover caps its width
  to the viewport.
- **Theme parity**: all standard overview/detail captures pass in light and dark with semantic
  surface tokens and legible health states.
- **No placeholder**: the UI is backed by authenticated local API records. Sample LVBT records were
  explicitly authorized for visual validation and are not committed as runtime fixtures.
- **Screenshot-verified**: the standard desktop/mobile light/dark set plus dependency and timeline
  lenses is attached above.

## Findings resolved

1. The old detail header buried the actual Project beneath navigation and exposed every property at
   once. The new shell leads with identity and outcome, then reveals secondary information through
   one anchored disclosure.
2. Lead and contributor presentation implied a distinction that is not useful in this context. The
   header now derives and deduplicates one Project people set without role labels.
3. Dependencies previously felt like a separate utility. They are now a native overview lens with
   curved directed edges, and Project/task dependency context remains available inside detail.
4. Medium-width tables previously collapsed metadata into cramped inline text. The complete aligned
   roster now stays intact inside a local horizontal scroller with two-line descriptions.
5. Labels and Resources were either absent or buried. Labels are real organization-global objects
   in Project info; URL Resources have a dedicated operating tab.

Verdict: **SHIP** — every dimension meets the craft bar and all hard gates are green.
