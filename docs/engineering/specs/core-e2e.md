# Core End-to-End Tests (area: `core-e2e`)

> **Status:** normative. This document is the register of every Playwright spec in the repo and the
> single place that declares which of them are **core** — the journeys whose failure means Docket
> does not ship. It is enforced by
> `packages/test-utils/tests/workspace-policies/e2e-discipline-policy.test.ts`, which fails if this
> register and the specs on disk diverge in either direction.

All specs live under `apps/web/e2e/` and run against the running dev stack
(`pnpm --filter @docket/web test:e2e`, config `apps/web/playwright.config.ts`). Specs are grouped
into topical subdirectories; **no spec may sit at the root of `apps/web/e2e/`** (SCR-21/SCR-22), and
no spec may be `.skip`, `.only`, or `.fixme` (SCR-16).

---

## 1. Machine-readable format

The policy check parses this document deterministically. Do not restyle §2 without updating the
parser.

- The register is the single Markdown table that follows the `## 2. Spec register` heading.
- Its header row is exactly `| Spec path | Core | Journey |`, followed by the usual separator row.
- Every data row has exactly three cells:
  1. **Spec path** — the spec path relative to `apps/web/`, wrapped in backticks, e.g.
     `` `e2e/auth/sign-in.spec.ts` ``. Every path must exist on disk.
  2. **Core** — literally `Yes` or `No`. Nothing else parses.
  3. **Journey** — one line of prose describing the user journey the spec covers.
- The table must list **every** `*.spec.ts` under `apps/web/e2e/`, core or not. A spec on disk that
  is missing from the table fails the check, and a table row pointing at a missing spec fails it too.

## 2. Spec register

| Spec path                                                | Core | Journey                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/auth/sign-in.spec.ts`                               | Yes  | A returning user signs in with a passkey and lands back in the app with a session that authenticated `/v1` calls accept.                                                                                                            |
| `e2e/auth/entry.spec.ts`                                 | Yes  | An already-signed-in person entering from the landing page reaches the app without any frame of the sign-in screen painting, and a signed-out person is bounced to sign-in with their destination preserved.                        |
| `e2e/auth/oauth-sign-in.spec.ts`                         | No   | The OAuth authorization round trip up to the provider boundary: consent, redirect, and callback handling. The provider itself is stubbed, so this does **not** yet prove a provider sign-in mints a session — see SCR-07.           |
| `e2e/auth/recovery-codes.spec.ts`                        | Yes  | A user generates recovery codes behind a passkey step-up, loses the device, recovers the account with one code, enrols a fresh passkey, and cannot replay the used code.                                                            |
| `e2e/auth/passkey-signal.spec.ts`                        | Yes  | A passkey revoked server-side is rejected at sign-in and pruned from the authenticator via the WebAuthn Signal API, so a removed credential stops working everywhere.                                                               |
| `e2e/auth/account-eol.spec.ts`                           | Yes  | A user exports their whole account as a downloadable ZIP, then schedules and cancels a recoverable account deletion.                                                                                                                |
| `e2e/athena/athena-personal.spec.ts`                     | Yes  | A user works with personal Athena end to end — dock, workbench, context surfaces, redirects, and both themes at desktop and mobile widths.                                                                                          |
| `e2e/athena/composer-reset.spec.ts`                      | No   | Regression guard: after a successful create, a still-mounted composer reopens pristine instead of holding the record just created.                                                                                                  |
| `e2e/athena/verify-composer.spec.ts`                     | No   | Screenshot capture of the new-task composer in light, dark, and discard states; asserts only that the composer opens.                                                                                                               |
| `e2e/calendar/layered-calendar.spec.ts`                  | Yes  | A user works a calendar layered over provider fixtures — read-only provider items stay openable without edit affordances, layer visibility reshapes the canvas live, and Docket events create/edit/delete with no provider account. |
| `e2e/calendar/layered-calendar-drawer.spec.ts`           | Yes  | From a calendar item's drawer a user creates and links tasks, writes an edit back to an editable provider event, and recovers from a sync conflict while permission-denied items explain their read-only state.                     |
| `e2e/calendar/google-calendar.spec.ts`                   | Yes  | A user opens the nested Google Calendar configuration surface and sees linked-calendar data feed the agenda rail.                                                                                                                   |
| `e2e/calendar/calendar-viewport-floor.spec.ts`           | No   | Layout floor guard: exactly one schedule canvas on screen, at or above a fifth of the viewport, with no horizontal overflow at any width.                                                                                           |
| `e2e/calendar/calendar-panel-floor.spec.ts`              | No   | Layout floor guard: the grid holds a tenth of the viewport across the full cross-product of rail, popover, menu, drawer, and sync-alert states, measured by area on the live element.                                               |
| `e2e/calendar/calendar-duplicate-events.spec.ts`         | Yes  | A user links two accounts that carry the same event and sees one block, not two, with the folded-away copy still discoverable from that block's own detail view.                                                                    |
| `e2e/calendar/calendar-event-into-block.spec.ts`         | Yes  | A user drags a calendar event into a time block and the association survives a re-read of the server and a full page reload — asserted mock-free against the real API.                                                              |
| `e2e/calendar/calendar-drag-evidence.spec.ts`            | No   | Screenshot capture of a rail-to-grid task drag, before and after, so a design review can score the interaction `fluid-scheduling-grid-drop.spec.ts` already asserts.                                                                |
| `e2e/scheduling/fluid-scheduling.spec.ts`                | Yes  | A user zooms the scheduling canvas, drags out a timebox, and is protected from DST gaps and folds, on pointer and on touch.                                                                                                         |
| `e2e/scheduling/fluid-scheduling-gestures.spec.ts`       | Yes  | A user moves items across dates and resizes both edges with overlapping items laid out in separate columns, while read-only provider items expose no edit targets and range failures show a safe retry notice over an intact grid.  |
| `e2e/scheduling/fluid-scheduling-grid-drop.spec.ts`      | Yes  | A user schedules a task by dragging it from the Tasks rail onto empty time in the calendar grid.                                                                                                                                    |
| `e2e/scheduling/fluid-scheduling-relations.spec.ts`      | Yes  | A user drags a task into a timebox and an event onto another event to create contained and related links between calendar items.                                                                                                    |
| `e2e/scheduling/fluid-scheduling-all-day.spec.ts`        | No   | Gesture edge case: an editable all-day range moves and resizes from its true edges by pointer and by keyboard.                                                                                                                      |
| `e2e/scheduling/fluid-scheduling-dense-overflow.spec.ts` | No   | Density edge case: an event hidden inside a dense cluster can be promoted back into the real pointer-edit surface.                                                                                                                  |
| `e2e/mcp/mcp-connect.spec.ts`                            | Yes  | An MCP client walks the whole OAuth 2.1 chain unmocked — discovery, dynamic registration, browser consent, PKCE exchange, a Bearer read, a `403 insufficient_scope` step-up, re-consent, and a write that lands.                    |
| `e2e/mcp/mcp-session.spec.ts`                            | Yes  | An `agents:run` MCP client triggers an agent session, observes it park at the approval gate, and approves the proposed action.                                                                                                      |
| `e2e/mcp/mcp-connect-cold-start.spec.ts`                 | No   | Incident regression guard: an MCP authorize request that arrives with no browser session resumes to consent after sign-in instead of dropping the user on `/today`.                                                                 |
| `e2e/platform/notifications.spec.ts`                     | Yes  | A user manages notification channels and contact points from settings.                                                                                                                                                              |
| `e2e/platform/pwa-offline.spec.ts`                       | Yes  | A visitor gets an installable app — a valid manifest with resolvable icons, a worker that takes control and precaches the offline page, an offline navigation that keeps its URL, and no caching of API, auth, or dev build output. |
| `e2e/platform/pwa-offline-sync.spec.ts`                  | Yes  | A user edits work with no connection, keeps the change on screen and through a reload, and the change reaches the server by itself once the connection returns.                                                                     |
| `e2e/platform/pwa-progressive-enhancement.spec.ts`       | Yes  | With service workers, Cache Storage and IndexedDB removed before any script runs, a user still reaches every main surface and can create and edit work, with no storage vocabulary shown to them.                                   |
| `e2e/work/verify-today.spec.ts`                          | No   | Screenshot capture of the Today surface and the agenda rail against seeded daily-plan tasks.                                                                                                                                        |
| `e2e/work/verify-attachments.spec.ts`                    | No   | Screenshot capture of the task-detail Attachments section, empty and after an upload.                                                                                                                                               |

## 3. What "core" means here

A spec is **core** when it covers a journey a user actually performs and whose failure would make
the launch untenable: getting into the account, getting back into it after losing a device, leaving
with the data, planning and scheduling work, connecting an agent, and being told what happened.

A spec is **not core** when it exists to hold a specific past bug down (`composer-reset`,
`mcp-connect-cold-start`, `calendar-viewport-floor`), to pin an edge case inside a journey another
core spec already covers (`fluid-scheduling-all-day`, `fluid-scheduling-dense-overflow`), or to
capture screenshots for human review (`verify-composer`, `verify-today`, `verify-attachments`).
Non-core specs still run in the same suite and still must pass — the distinction is about which
journeys the launch bar is measured against, not about which tests are allowed to fail.

## 4. Enforcement

`packages/test-utils/tests/workspace-policies/e2e-discipline-policy.test.ts` asserts, over the real
repo:

1. Every spec path listed in §2 exists on disk.
2. Every `*.spec.ts` under `apps/web/e2e/` appears in §2 — the two lists may not diverge.
3. At least one spec is marked `Core = Yes`, and every core-marked path exists.
4. No spec under `apps/web/e2e/` contains `.skip`, `.only`, `.fixme`, or their `test.describe`
   variants.
5. No `*.spec.ts` sits directly at the root of `apps/web/e2e/`.
