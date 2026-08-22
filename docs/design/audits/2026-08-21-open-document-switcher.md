---
date: 2026-08-21
surface: Open-document switcher
route: Authenticated task detail, one active task and twelve persisted background tasks
verdict: ship
---

# Design review: Open-document switcher — 2026-08-21

The switcher now reads as a compact search surface instead of a stack of oversized destructive
buttons. Each result stays on a 44px line. The close action appears only when the row needs it on
a mouse, while touch keeps the 40px target visible. The action no longer changes title width or
competes with the row's primary link.

Screenshots:

- [1440×900 light](screenshots/2026-08-21-open-document-switcher/switcher-1440x900-light.png)
  and [dark](screenshots/2026-08-21-open-document-switcher/switcher-1440x900-dark.png)
- [390×844 light](screenshots/2026-08-21-open-document-switcher/switcher-390x844-light.png)
  and [dark](screenshots/2026-08-21-open-document-switcher/switcher-390x844-dark.png)
- [Close hover](screenshots/2026-08-21-open-document-switcher/switcher-close-hover-1440x900-light.png)
  and [keyboard focus](screenshots/2026-08-21-open-document-switcher/switcher-keyboard-focus-1440x900-light.png)

The live pass created one real active task and twelve real persisted background tasks. It measured
44px rendered rows, a 320px seven-row scroll region, a nominal 352px compact panel, and the
480px desktop cap. Radix applies the shared viewport collision inset at the right edge, so the
live panel can render a few pixels under its nominal width without crossing the cap. The final
row remained reachable by scroll, long titles truncated without horizontal overflow at 320px, and
the post-onboarding switcher path produced no console or page errors.

| Dimension                  | Score | Evidence                                                                                                                                                                                                   |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice   | 4     | The neutral MD3 panel, quiet type glyphs, and direct search label match the surrounding shell without another visual language.                                                                             |
| Typographic craft          | 4     | Result labels stay readable at desktop and phone widths. The long task title truncates cleanly while its delayed tooltip retains the full name.                                                            |
| Spatial rhythm and density | 4     | Fixed 44px rows and 8px panel padding remove the former 56px stack. The 320px result viewport shows seven rows before scrolling.                                                                           |
| Hierarchy and information  | 4     | Search leads. A selected row has a distinct tonal role. Close actions stay subordinate until hover, focus, or touch requires them.                                                                         |
| Color discipline           | 4     | Selected and ordinary close-hover layers derive from their row roles. Light and dark retain the same hierarchy.                                                                                            |
| Motion and feedback        | 3     | Fine-pointer close actions fade in without moving labels. Focus exposes the same target and visible ring. Tooltip handoff never leaves competing labels on screen.                                         |
| States completeness        | 4     | The browser pass covers filtering, closing in the scroll region, keyboard order, close-focus recovery, title and close tooltips, selected and ordinary hover layers, touch visibility, and 320px overflow. |
| Detail craft               | 4     | The 40px target contains a 28px painted state layer with a centered 16px glyph. Leading glyphs are a quieter 18px.                                                                                         |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · Keyboard ✅ · Touch ✅ · Screenshot-verified ✅

The 2026-08-09 audit is superseded. It covered six documents, not thirteen, and did not inspect
close hover or composed row height. Those omissions hid the inflated row and the always-visible
close rail.
