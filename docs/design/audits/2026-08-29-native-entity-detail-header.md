# Design review: native entity detail headers — 2026-08-29

Screenshots: `apps/web/.data/design-review/entity-detail-header/` contains Initiative, Program, and
Project captures at 1440×900 and 390×844 in light and dark mode. It also contains the Project
320×720 overflow and date-picker captures plus the Project–Initiative association captures.

| Dimension                        | Score | Evidence                                                                                                                                                                                  |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | The app uses the calm Plex/MD3 register throughout. Entity glyphs carry the chosen identity without turning the masthead into a decorative card.                                          |
| Typographic craft                | 3     | The entity name is the sole headline. The summary, metadata, tab labels, and section headings descend in clear weight and scale at 1440px and 390px.                                      |
| Spatial rhythm and density       | 3     | The icon, title, metadata, and tabs hold a consistent left edge on desktop. At 390px the header becomes a single deliberate column instead of compressing the desktop row.                |
| Hierarchy and information design | 3     | Name and outcome lead. Ownership stands apart from operational properties on Project, and the Overview tab leads into the entity-specific next-work surface.                              |
| Color discipline                 | 3     | Light and dark captures use neutral surface layers. Blue status, green health, and the entity icon accent carry meaning instead of decoration.                                            |
| Motion and feedback              | 3     | The responsive proof covers focusable overflow and the date picker opened by keyboard. The shared header retains the scroll-collapse endpoint without moving actions away from the title. |
| States completeness              | 3     | Empty updates, empty connected work, and empty Project work explain the next action. The 320px Project overflow exposes hidden properties and date controls rather than clipping them.    |
| Detail craft                     | 3     | The 320px Project capture has no horizontal overflow. The metadata menu stays in the viewport, tabs remain readable, and icon, border, and focus treatments match the rest of the app.    |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Evidence

- `initiative-header-1440x900-light.png`, `initiative-header-1440x900-dark.png`,
  `initiative-header-390x844-light.png`, and `initiative-header-390x844-dark.png`
- `program-header-1440x900-light.png`, `program-header-1440x900-dark.png`,
  `program-header-390x844-light.png`, and `program-header-390x844-dark.png`
- `project-header-1440x900-light.png`, `project-header-1440x900-dark.png`,
  `project-header-390x844-light.png`, `project-header-390x844-dark.png`,
  `project-header-320x720-overflow-light.png`, and `project-header-320x720-start-picker-light.png`
- `project-initiative-association-wide-initial.png` and
  `project-initiative-association-390-final.png`

The browser proof passes all three flows: Initiative and Program headers, Project header overflow,
and Project–Initiative association replacement. The Project overflow menu receives keyboard focus,
opens the named Start date and Target date controls, and opens the Start date calendar grid.

Verdict: SHIP.
