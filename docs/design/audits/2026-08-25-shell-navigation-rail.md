---
surfaces: ['shell-navigation-rail']
date: 2026-08-25
verdict: blocked
scores:
  brand: null
  typography: null
  spacing: null
  hierarchy: null
  color: null
  motion: null
  states: null
  detail: null
gates:
  a11y: false
  responsive: false
  theme-parity: false
  no-placeholder: false
  screenshots: false
---

# Design review: Shell navigation rail — 2026-08-25

**Verdict: BLOCKED.** Web maintainers must run this review again after the browser can reload the
local app. The navigation implementation is committed and its focused checks pass, but this
scorecard cannot assign craft scores without screenshots.

## Screenshot status

The required screenshot root is
`docs/design/audits/screenshots/2026-08-25-shell-navigation-rail/`. It contains no capture yet.

The normal local command could not start because the HTTPS proxy requires sudo. The direct dev
server started on port 3007 after loading the local API configuration. It initially rendered the
owned Page unavailable state because the API certificate is self-signed. Restarting with local TLS
verification disabled removed that runtime blocker. Browser automation then rejected the required
localhost reload under its URL policy. No alternate browser automation path was used.

## Scores

| Dimension                 | Score | Evidence             |
| ------------------------- | ----- | -------------------- |
| 1. Brand identity & voice | N/A   | No captured surface. |
| 2. Typographic craft      | N/A   | No captured surface. |
| 3. Spatial rhythm         | N/A   | No captured surface. |
| 4. Hierarchy              | N/A   | No captured surface. |
| 5. Color discipline       | N/A   | No captured surface. |
| 6. Motion & feedback      | N/A   | No captured surface. |
| 7. States completeness    | N/A   | No captured surface. |
| 8. Detail craft           | N/A   | No captured surface. |

## Hard gates

| Gate                | Result  | Evidence                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------- |
| A11y                | Blocked | Keyboard focus has focused unit coverage, but the live audit could not inspect it. |
| Responsive          | Blocked | The 320px overflow check could not run against the local app.                      |
| Theme parity        | Blocked | No light or dark screenshot could be captured.                                     |
| No placeholder      | Blocked | The live route could not settle after the browser policy blocked reload.           |
| Screenshot-verified | Blocked | Browser automation blocked the localhost reload before capture.                    |

## Repository gate status

The focused shell suite passes 102 tests across six files. UI lint, UI type checking, and the
eight-case design-token policy pass. The full bounded typecheck passed 25 packages, and the API
package passed when rerun with a command-scoped 4 GB heap after Node exhausted its default 2 GB
heap. Both navigation commits passed the staged formatting, policy, and lint hook.

The aggregate lint script stopped at its API task's 180-second watchdog. An isolated API lint
produced no lint diagnostic for four minutes and was stopped. This review does not treat that as a
passing repository gate.

## Findings

1. The screenshot audit is missing. The browser URL policy blocks the required localhost reload.
   Rerun at 1024×900 and 1440×900 in light and dark themes, then test the More menu, Inbox unread
   state, keyboard focus, and both density transitions before replacing this blocked scorecard.
