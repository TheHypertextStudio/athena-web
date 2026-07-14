# Design review: Initiative mobile rhythm — 2026-07-14

Screenshots:

- `screenshots/initiative-mobile-spacing/orgs-orgId-initiatives-1440x900-light.png`
- `screenshots/initiative-mobile-spacing/orgs-orgId-initiatives-1440x900-dark.png`
- `screenshots/initiative-mobile-spacing/orgs-orgId-initiatives-390x844-light.png`
- `screenshots/initiative-mobile-spacing/orgs-orgId-initiatives-390x844-dark.png`

Register: app — calm, dense, keyboard-first Plex/MD3. The captures use a real fresh local account,
so the recovery reminder and Initiative empty state are authentic first-run states rather than demo
data.

| Dimension                         | Score | Evidence                                                                                                                                                                                               |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         |     3 | The page retains Docket's neutral MD3 application register, vocabulary-resolved Initiative copy, and direct recovery guidance without adding decorative card language.                                 |
| 2. Typographic craft              |     3 | The page title keeps the named branded scale, while the recovery message measures at the standard 14px body size at 320px. Neither the reminder nor the primary action wraps word by word.             |
| 3. Spatial rhythm & density       |     3 | The banner uses a stable icon/content/dismiss grid. Runtime measurement shows a 0px message/action left-edge delta, a 24px header-to-attention gap, and 32px after attention before the working state. |
| 4. Hierarchy & information design |     3 | Recovery guidance, Initiative identity/action, attention, and the roster state read as four distinct groups. The recovery action sits with its explanation rather than beside dismissal.               |
| 5. Color discipline               |     3 | The existing `surface-container-high` recovery surface remains visibly distinct in both themes; semantic red is limited to the recovery warning icon and the primary action retains the org accent.    |
| 6. Motion & feedback              |     3 | The action and dismiss controls retain shared hover, transition, and focus-ring treatments without adding decorative motion.                                                                           |
| 7. States completeness            |     3 | The captured first-run state includes the recovery reminder, empty attention state, and actionable Initiative empty state; existing loading, error, and populated roster states remain unchanged.      |
| 8. Detail craft                   |     3 | At 320px the page reports `scrollWidth === innerWidth`; both recovery controls measure 40px tall, the dismiss target is 40×40px, and the browser console is clean.                                     |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: the action and dismiss control remain keyboard-operable with visible shared focus
  treatment; both are at least 40px high and dismissal retains its accessible label.
- **Responsive**: runtime verification at 320px measured no page overflow, exact message/action
  alignment, and 40px controls. The 390px screenshots show natural phrase wrapping.
- **Theme parity**: the same hierarchy and tonal separation remain visible in light and dark.
- **No placeholder**: the account and empty states were created through the real local application.
- **Screenshot-verified**: the standard 1440×900 and 390×844 light/dark set is attached above.

## Findings resolved

1. The recovery message, action, and dismissal previously competed in one inline flex row. The
   banner now uses three columns and nests the action below the message.
2. The action container aligned while its padded label did not. The production text action now has
   no left inset, producing an exact measured left-edge match with the message.
3. The Initiative page used a uniform 20px stack. It now uses a 24px base rhythm and adds 8px after
   the attention surface to distinguish executive context from roster work.

Verdict: **SHIP** — every dimension meets the craft bar and all hard gates are green.
