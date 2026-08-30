# Design review: Programs roster (Cards lens) — 2026-08-29

This review covers `/orgs/[orgId]/programs` after the Cards lens became the Program roster's
default and its card was rebuilt. Screenshots are in `screenshots/2026-08-29-programs-cards/`
(1440×900 + 390×844, light and dark). `desktop-light-varied-activity.png` renders the same cards
with an eight-week activity window substituted into the work-view response, because a dev
workspace's records are all new and every real window is empty — the component and its data
contract are the shipped ones, only the eight weekly counts are stand-ins.

| Dimension                           | Score | Evidence                                                                                                                                                                                                            |
| ----------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | Quiet MD3 surfaces, one blue status badge, and the fixed `Layers` mark. Copy states what a Program is doing ("On track · Active yesterday") rather than labelling fields.                                           |
| 2. Typographic craft                |     3 | Four roles, each carrying a level: `title-medium` name, `body-small` summary, `label-medium` verdict and roll-up, `label-small` recency. No raw type utilities remain in any touched file.                          |
| 3. Spatial rhythm and density       |     3 | One `gap-3` rhythm inside a single `p-4` inset. The card and its link no longer both declare padding, so content and the selection checkbox share one content column.                                               |
| 4. Hierarchy and information design |     3 | Name first, summary second, then verdict and roll-up pinned to the bottom edge, so the second and third bands line up across a row regardless of summary length or a missing verdict.                               |
| 5. Colour discipline                |     4 | Health is the only earned colour on the card. The activity histogram was drawn in `primary/45`; it is now `outline`, so the one coloured mark is the one that carries a judgment.                                   |
| 6. Motion and feedback              |     3 | Hover and focus are colour-only. The glyph cross-fades to the selection checkbox on the shared opacity transition — the same swap the List lens performs, and no geometry changes.                                  |
| 7. States completeness              |     3 | Quiet, partial, and busy activity windows all read as data. A Program with no verdict shows none instead of an em dash, and the loading skeleton is now card-shaped so the roster fills in rather than rearranging. |
| 8. Detail craft                     |     3 | At 200% the bars sit on the text baseline and the roll-up numerals align. Titles wrap to two lines before truncating at every captured width.                                                                       |

Gates: A11y ✅ (every week keeps its own accessible name; the quiet window states itself; the
checkbox keeps its label) · Responsive ✅ (`capture-shots` 320px overflow check passes; 1-up at
390, 2-up at 1440 beside the calendar rail) · Theme parity ✅ (light and dark captured) · No
placeholder ✅ (the generic card's empty glyph spacer is gone, and Display → Properties now
changes the card instead of doing nothing) · Screenshot-verified ✅

## What changed and why

1. **Both the card and its inner link declared `p-4`** — content sat 32px in while the hover
   checkbox stayed pinned at 16px, floating in the gutter. The link is now the only padding owner.
2. **The card carried less than the row it replaced.** `ProgramViewRow` has `status`, `ownerActor`,
   `projectCount`, and `taskCount`; the card showed none of them. It now shows all four, and honours
   `presentation.properties` so the Display control governs it.
3. **The activity histogram had no baseline**, so a run of quiet weeks rendered as disconnected 4px
   stubs. Weeks are now full-height tracks the bar fills from the bottom, an entirely empty window
   collapses to one flat rule, and the inline `style={{ height }}` is a four-rung ladder of static
   heights.
4. **Health was grey with a coloured dot.** The verdict now takes the colour, and health and recency
   share one line instead of two crowded ones.

## Follow-ups

- The card renders `status`, `health`, `owner`, `projectCount`, and `taskCount`. Switching on
  `labels`, `initiatives`, `visibility`, `creator`, or `updatedAt` still changes nothing on this
  lens; those need resolvers the card does not have yet.
- Non-Program targets share the rebuilt frame but still render the generic label/value list.
  A Project or Initiative card could carry its lead, dates, and progress the way this one does.
