---
surfaces: ['settings']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 2
  color: 3
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /settings (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** The strongest of the five app surfaces reviewed in this pass — six
dimensions clear the bar and every gate is green — but hierarchy and detail craft do not, and the
route emits two page errors on load.

This pass re-reviews the surface covered by `2026-07-14-settings-production.md`, which scored it at
the ship bar. Two of that review's conclusions still hold on inspection (the mobile destination row,
the real image picker); the cursor and page-error findings below are new.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                          |
| ----------------- | ---------------------------------------------- |
| Standard shot set | `settings-{1440x900,390x844}-{light,dark}.png` |

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | "Settings — Your account, preferences, and connected apps." says whose settings these are, which matters in a product where a workspace also has settings. "Your identity — This is the identity Athena uses when working across your connected services" explains a field by explaining the model behind it, which is authored writing rather than a label.                                 |
| 2. Typographic craft              | 3     | Measured: `h1` at 22px over a 14px subtitle; section heading 16px; card heading, field label, and help text step down cleanly below it. Five distinct levels resolve without any ad hoc size, and the long email value renders in the same scale at 390 without wrapping mid-token.                                                                                                          |
| 3. Spatial rhythm & density       | 3     | Measured at 1440: `main` is 1176x884 at x=256 (no agenda rail on this route, correctly), content insets to x=295 with the section rail at x=295 and the content column at x=567. One 24px vertical rhythm inside the identity card. The trailing 298px below the card is proportionate to a settings page that grows with its content.                                                       |
| 4. Hierarchy & information design | 2     | The page body passes the five-second test — one section rail, one open section, one card, one clear identity editor. The shared frame does not: the sidebar lists **"Stream" twice**, once personal and once under "Workspace", with the same word and icon, plus Today/My Work and Inbox/Triage. That is the same shell finding recorded on all five surfaces in this pass.                 |
| 5. Color discipline               | 3     | Neutral-first; the accent carries the active rail row and nothing else on the surface. `settings-1440x900-dark.png` re-tints the rail, card, and input so all three still read as distinct surfaces in dark.                                                                                                                                                                                 |
| 6. Motion & feedback              | 3     | Keyboard `Tab` paints a visible focus ring at each stop reached. No dead control was found: `Choose image` opens a real picker and the name field is a live editor, matching the 2026-07-14 review's finding that the image fields were converted from raw URL entry.                                                                                                                        |
| 7. States completeness            | 3     | Nothing dead. The identity card is a functional inline editor rather than a read-only property list — name is editable, the photo has a real chooser with a stated format and size limit, and the email row explains _why_ it is not editable here ("Change your sign-in email from Security, where the confirmation step is protected") instead of showing a greyed field with no reason.   |
| 8. Detail craft (squint test)     | 2     | Measured: 34 visible controls, all enabled, of which **6** compute `cursor: default` — the workspace switcher, the shell search, the nudge dismiss, the account row, `Choose image`, and the Athena launcher. This is the lowest count of the five surfaces, but `Choose image` is a content control, not shell chrome. Separately, the route emits two page errors on load — see finding 2. |

Gates: A11y ✅ (document overflow at 320/390/1440 = 0/0/0px; visible keyboard focus; no control
under the 40px mobile floor except the standard visually-hidden skip link at 18px; lowest measured
text contrast 5.01:1, above AA) · Responsive ✅ (the desktop section rail becomes a horizontal
scrollable destination row at 390 — `settings-390x844-light.png`) · Theme parity ✅ · No placeholder
✅ (every visible destination is real; the email row explains its own read-only state rather than
sitting dead) · Screenshots ✅

## Findings (ordered by severity)

1. **Six enabled buttons compute `cursor: default`,** including `Choose image`, which is a content
   control rather than shell chrome. Same shared Button primitive as the other four surfaces.

2. **The route emits two page errors on load.** Captured verbatim:
   `TypeError: Failed to execute 'measure' on 'Performance': '​GlobalSettingsRootPage' cannot
have a negative time stamp.` — twice, on every load. The zero-width space prefixing the mark name
   identifies it as **Next.js's own dev-mode render instrumentation**, not application code, and it
   is what raises the red `1 Issue` dev-overlay badge visible at the bottom-left of
   `settings-1440x900-light.png` and `settings-390x844-light.png`. That badge is a development
   affordance and is not part of the shipped surface, so it is not scored as UI. The error itself is
   recorded because it is the only page error found on any of the six surfaces in this pass, and
   because GEN-02 grades production on "zero console errors" — a bar this dev-only observation
   cannot settle either way.

3. **The floating Athena launcher covers the section rail at 390px**, with no reserved gutter.

## Not verified in this pass

Only the `/settings` root (Profile) was captured. The nine sibling destinations in the rail —
Athena, Connections, Automations, Notifications, Calendar, Security, Connected apps, Data & privacy,
Workspaces — are separate rows in `docs/design/surface-inventory.md` and are not scored by this
document. Save/dirty-state behaviour and the image upload path were not exercised.
