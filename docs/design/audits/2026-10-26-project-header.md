# Design review: Project header — 2026-10-26

Scope: the project header, its Properties disclosure, type identity and definition menu. Rich custom fields and actionable empty states remain a labeled future concept, not production capability.

Screenshots: `/Volumes/WillieDrive/CodexScratch/athena-project-header-ui/captures/`. Thirty-two frames cover header, Properties, menu and long title at 1440×900, 390×844, 320×844 and 390×600, light and dark.

| Dimension                      | Score | Evidence                                                                                                                                                                                  |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity & voice         | 3     | The header uses the app's neutral Plex register. Project replaces Blank project; custom type names remain authored names.                                                                 |
| Typographic craft              | 3     | Quiet type label sits above the editable title; summary and compact property labels are subordinate in desktop and phone header frames.                                                   |
| Spatial rhythm & density       | 3     | Icon, title and actions form one aligned identity group. Essential property editors wrap together rather than forming separate owner and action rows.                                     |
| Hierarchy & information design | 3     | Identity precedes operational context; labeled Properties discloses supplemental fields. Definition revision appears only in explicit details.                                            |
| Color discipline               | 3     | Neutral surfaces carry structure; health and selected navigation retain semantic color in both captured themes.                                                                           |
| Motion & feedback              | 3     | Shared menu, dialog and picker primitives retain feedback and focus behavior; the skeleton follows the new identity arrangement. Browser coverage checks focus return across disclosures. |
| States completeness            | 3     | Long titles wrap without hiding actions; unset owner, health and dates remain editable. Identity failure/retry and read-only provenance have component coverage.                          |
| Detail craft                   | 3     | Desktop and narrow phone frames retain aligned action targets and visible editors; overflow and mobile target size assertions pass.                                                       |

Gates: A11y passes scoped axe, keyboard/focus and ≥40px mobile target checks. Responsive passes the measured 320–1440 viewport matrix; the 1440 frame also exercises a constrained center pane. Theme parity passes captured light/dark states. No placeholder passes for the production header; the separate future concept labels its sample content. Screenshot verification passes for the visual claims above.

## Findings

No blocking finding within the reviewed scope. At 320px, very long titles use substantial vertical space to preserve the full editable name and reachable actions. This is a deliberate readability tradeoff. The horizontally scrollable tab strip retains the surrounding app behavior.

Verdict: Meets the scoped craft bar. This is local UI acceptance, not deployment or provider acceptance. Read-only, unavailable identity and loading behavior are supported by component evidence rather than a claim that every state was captured in the browser.
