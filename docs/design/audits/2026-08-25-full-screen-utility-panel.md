# Design review: Full-screen compact utility panel — 2026-08-25

The review covers the authenticated Agenda utility panel at the compact, medium, and desktop
breakpoints. The compact screenshots use an isolated audit account and location/event fixture. The
fixture exists only in the audit database and is not product placeholder content.

Screenshots:

- `screenshots/2026-08-25-full-screen-utility-panel/320x844-light.png`
- `screenshots/2026-08-25-full-screen-utility-panel/320x844-dark.png`
- `screenshots/2026-08-25-full-screen-utility-panel/390x844-light.png`
- `screenshots/2026-08-25-full-screen-utility-panel/390x844-dark.png`
- `screenshots/2026-08-25-full-screen-utility-panel/390x844-light-keyboard-focus.png`
- `screenshots/2026-08-25-full-screen-utility-panel/768x1024-light.png`
- `screenshots/2026-08-25-full-screen-utility-panel/768x1024-dark.png`
- `screenshots/2026-08-25-full-screen-utility-panel/1024x900-light.png`
- `screenshots/2026-08-25-full-screen-utility-panel/1024x900-dark.png`
- `screenshots/2026-08-25-full-screen-utility-panel/1440x900-light.png`
- `screenshots/2026-08-25-full-screen-utility-panel/1440x900-dark.png`

The compact and medium layout follows Google's supporting-pane rule: a small window shows one pane
at a time, while a large window shows the main and supporting panes side by side. The implementation
keeps Docket's existing 1024px breakpoint. Sources:
[supporting pane layout](https://developer.android.com/develop/adaptive-apps/guides/build-a-supporting-pane-layout),
[Material canonical layouts](https://m3.material.io/foundations/layout/canonical-examples/overview).

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | The compact pane keeps Docket's calm Plex and MD3 app register. Agenda, Timeline, Home, and date labels use product language without adding generic sheet copy.                                                                                           |
| 2. Typographic craft                |     3 | The panel switcher, month trigger, weekday strip, hour labels, and event cards preserve the shared type scale. Labels remain on one line or truncate at 320px instead of wrapping.                                                                        |
| 3. Spatial rhythm and density       |     3 | The pane app bar is 48px high. Its controls use 40px targets and 8px horizontal padding. The timeline uses a measured 12px outer gutter. At 320px the `12 PM` label begins at x=11.2px and the 24px location marker occupies x=56–80px without clipping.  |
| 4. Hierarchy and information design |     3 | Compact and medium widths show one task at a time: panel selection and dismissal in the app bar, date and display controls below, then the schedule. At 1024px the page and supporting Agenda rail return side by side.                                   |
| 5. Color discipline                 |     3 | Both themes use semantic surface, primary, tertiary, outline, and error tokens. The blue event pair measures 5.57:1 in light mode and 8.54:1 in dark mode.                                                                                                |
| 6. Motion and feedback              |     3 | Radix keeps the sheet focus trap, Escape dismissal, and opener focus return. Keyboard focus on Close Agenda renders a two-pixel shared focus ring. Reduced-motion behavior remains in the shared Sheet and scheduling controls.                           |
| 7. States completeness              |     3 | The authenticated populated state covers all-day Home, a partial-day place rail, overlapping timed events, title truncation, and native schedule scrolling. The panel selector can switch Agenda, Focus, and Athena without another shell row.            |
| 8. Detail craft                     |     3 | At 320px the dialog measures exactly 320×844 with no border or shadow. The document and schedule scroll widths equal their client widths. The Agenda scrollport uses `scrollbar-width: none`, while a native scroll gesture moved it from 344px to 524px. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

The accessibility check confirmed a 40×40 close target, a visible two-pixel keyboard focus ring,
focus trapping, Escape dismissal, and focus return to Show Agenda after a real pointer open. The
responsive check found no horizontal overflow at 320, 390, 768, 1024, or 1440px. At 320px, the
dialog and app bar cover the full viewport and the page below is `aria-hidden`. Light and dark
captures show the same hierarchy and readable semantic colors.

There are no ship-blocking findings. The previous partial sheet exposed ten percent of the page and
spent that width without preserving a usable two-pane view. The full-window compact pane removes
that dead strip. The existing docked rail remains the correct supporting-pane treatment at 1024px
and wider.

Verdict: SHIP.
