---
surfaces: ["orgs-[orgId]-projects-[projectId]"]
date: 2026-10-26
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

# Design review: Project description and mobile composition — 2026-10-26

This review replaces the earlier mobile acceptance. The user correctly rejected the long-title frame: its seven-line middle column, three essential-property rows, clipped navigation and oversized empty editor did not serve the work. Passing overflow checks had not established a coherent composition.

Scope: the general project UI, including full-width mobile titles, compact context/actions, essential properties, section navigation and the description. Custom properties and configurable tabs remain excluded.

Screenshots: `/Volumes/WillieDrive/CodexScratch/athena-project-header-ui/writing-captures/`. Twenty-four named frames cover populated description, empty description and the rejected long-title case at 1440×900, 390×844, 320×844 and 390×600 in both themes. The actual 320px long-title frame was explicitly inspected before committing.

| Dimension                      | Score | Evidence                                                                                                                                                                                                                                                                |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity & voice         | 3     | The app's neutral Plex register is retained. Navigation conveys real location; the user-defined type stays near the title. Empty prompts name Owner, Health and dates directly.                                                                                         |
| Typographic craft              | 3     | The long title retains the full pane width. Tabs use the current Material Title Small role (14px / 20px at default scale), with 48px targets. Content-aware gutters fit all four names without reducing type.                                                           |
| Spatial rhythm & density       | 3     | Icon, breadcrumb and actions share one context row on phones. Owner/status/health share one row, dates another. Shared stylesheet rules remove the extra 16px between metadata and tabs.                                                                                |
| Hierarchy & information design | 3     | The title receives full width; metadata is grouped, not scattered. Overview starts with the description. Its writing area occupies at least 20% of the viewport, with a 192px default-scale floor, so prose has meaningful space ahead of secondary execution sections. |
| Color discipline               | 3     | Existing semantic surfaces and text carry the composition in both captured themes. Health and active navigation retain meaningful color.                                                                                                                                |
| Motion & feedback              | 3     | The existing editor still saves on blur and survives reload. Existing picker, menu and dialog focus behavior passes. Header height continues to be measured by the shared collapse controller.                                                                          |
| States completeness            | 3     | Captures cover filled dates/health, unset fields, long names and short/long prose. The writing presentation reserves max(12rem, 20svh), then grows naturally with content. Normal and compact document presentations remain available for other surfaces.               |
| Detail craft                   | 3     | No clipped Updates label remains at 320px. Header geometry assertions now verify title width, property-row alignment, tab reachability and the metadata/tab gap rather than only page overflow.                                                                         |

Gates: scoped accessibility, responsive behavior, theme parity, no placeholder capability, and screenshot verification pass. All five essential property controls remain visible and meet the existing mobile touch-target check. Keyboard tab behavior, description persistence, program navigation and menu focus return pass. The matrices use normal text scale; this is not manual screen-reader certification.

## Evidence and corrections

- Forty-five affected web component tests pass across the focused runs, including the corrected single Owner prompt expectation. Twenty-six shared UI tab tests pass.
- UI/web typechecks, affected lint, complexity and the production build passed for the structural change. The final shared CSS spacing correction was compiled by the standard dev stack and verified by the three final browser journeys and the final capture matrix; no redundant production build was required for that correction.
- The first rendered revision still had an extra 16px before the tabs because an unlayered shared stylesheet overrode the utility classes. The correction lives beside the existing shared layout rules, scoped to the inline identity presentation and narrow panes. A browser assertion limits the metadata/tab gap to 8px.

No blocking finding remains in this scope. Long parent names truncate within the compact context row while retaining their full accessible link name and native title. The editor's read-only behavior is unchanged. Integration and deployment are outside this local delivery.

## Writing-space and tab-size follow-up

The user asked for a substantially larger description area and questioned the small tabs. The earlier 12px compact override did not use the current Material tab typography. It was removed: Title Small supplies 14px text with 20px line height and medium weight, and the text-only target remains 48px high. Google's current references are [PrimaryNavigationTabTokens](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/PrimaryNavigationTabTokens.kt) and [TypeScaleTokens](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/TypeScaleTokens.kt). The compact web lane uses content-aware widths; this review verifies these metrics, not full conformance to every Expressive motion or layout requirement.

The previous small empty-description preference is superseded by a writing region at least 20% of the viewport. The latest 24-frame capture matrix shows both empty and populated content, with the compact header retained. Browser assertions verify the actual 14px labels, 48px targets, complete labels and minimum description height, alongside the existing persistence and navigation journey. All three browser journeys, 26 shared tab tests, five editor tests, affected lint/typechecks and complexity check pass. The stack was stopped and seeded database reset after the review.
