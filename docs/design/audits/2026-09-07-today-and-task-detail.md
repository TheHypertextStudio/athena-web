---
surfaces: ['today', 'orgs-[orgId]-tasks-[taskId]']
date: 2026-09-07
verdict: ship
scores:
  brand: 3
  typography: 4
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

# Design review: Today and task detail — 2026-09-07

Screenshots: `screenshots/2026-09-07-today-and-task-detail/` — 1440×900, 390×844, 390×600 and 320×844,
light and dark, for both surfaces.

Seeded through the running API on `dev-stack.sh`: one project, seven tasks spanning backlog through
done with priorities, estimates and due dates either side of today, three subtasks and one blocking
dependency on the task under review, and five daily-plan rows on the Hub's own date.

This is the first scorecard for either surface. `orgs-[orgId]-tasks-[taskId]` had none at all, which
is part of the open GEN-10 gap recorded in `surface-inventory.md`.

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                                                    |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | Calm Plex/MD3 in the app register throughout, no decoration, no developer tells. Copy is written rather than templated — "Unblocks 1 task" earns its place beside the estimate. Not a 4: nothing here would identify the product with the mark cropped out.                 |
| 2. Typographic craft      | 4     | Both surfaces are now entirely on the fifteen roles, and the hierarchy is legible from the type alone: `title-large` page title, `label-large` row titles, `body-small` subtitles and meta. Every file behind them left `design-token-debt.json` in this pass.              |
| 3. Spatial rhythm         | 3     | One 4px rhythm per surface and aligned row edges; the Plan list's rows share one gutter axis across glyph, title and trailing meta. The weakest measurement is task detail's description editor, whose `min-h-56` holds a 224px box around one line of text at every width. |
| 4. Hierarchy              | 3     | Today answers the five-second test: what day, what is now, what is planned. The "Now" card is the one primary action and the rest of the list is subordinate. Task detail leads with title then status then content, and its one primary action is Track.                   |
| 5. Color discipline       | 3     | Neutral apart from earned colour: the indigo primary on Complete, the red Blocked and overdue Sep 5, the org accent dot, and the status glyph ramp. Zero hardcoded values; both themes verified by screenshot rather than assumed.                                          |
| 6. Motion & feedback      | 3     | Transitions run on `--dur-fast/base/slow` with the MD3 curves, and `prefers-reduced-motion` is honoured in `globals.css`. The agenda card's hover lost its shadow in this pass and is now a tonal step plus a 1px lift, which is movement rather than a resize.             |
| 7. States completeness    | 3     | Seeded content on both surfaces, and no dead rows: every property chip on task detail opens a picker. Not a 4 — "No linked resources yet." in the Resources panel is still bare text rather than the `EmptyState` atom, and it teaches nothing.                             |
| 8. Detail craft           | 3     | Zero horizontal overflow at 320px, asserted by `capture-shots.ts` rather than eyeballed. Long titles truncate on Today and wrap on task detail, which is right for each. Icon sizes and stroke weights are consistent per context.                                          |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings (ordered by severity)

1. **The description editor reserves 224px it does not use.** `min-h-56` on the editor shell
   (`apps/web/src/components/editor/entity-document.tsx:206`) means a one-line description renders
   in a 224px box at every width, which reads as a loading state that never resolved. It is the
   largest empty region on task detail in all four shots. The floor is shared by every entity
   document, so lowering it is a decision about the project, initiative and program pages too —
   worth taking deliberately rather than tuning here.
2. **"No linked resources yet." is bare text.**
   `apps/web/src/components/entity-detail/resources-tab.tsx:311` — it names neither what a resource
   is nor how to add one, while an "Add resource" button sits directly above it. Use the
   `EmptyState` atom with `frame="none"`, as the three empty states fixed in this pass now do.
3. **The recovery-codes nudge occupies the sidebar's whole lower third.** Visible in every shot at
   1440×900. It is correct copy and a real prompt, but it is the largest single block in the chrome
   and outweighs the navigation it sits under.

## What this pass changed on these surfaces

Both surfaces moved fully onto the type roles. The only deliberate visual change on Today is its
`<h1>`, which carried `font-semibold` and now does not: every other page title in the product —
Tasks, Inbox, My Work, Triage, Teams, Portfolio, Views, Search and task detail — is plain
`text-title-large`, so Today was the outlier and now matches. The screenshots confirm the heading
still carries the page on size rather than weight.

Two files behind these surfaces stay in `design-token-debt.json` on purpose.
`components/views/page-layout.tsx` and `components/views/entity-detail-layout.tsx` both use
`text-headline-medium font-medium`, and `page-layout.tsx` documents that pairing as the owned
canonical title token. The scale has no 28px/500 role, so closing them means either accepting weight
400 on every list and detail page title or adding a role. That is a design decision, and it is open.

Verdict: **SHIP** — every dimension is at or above the bar of 3 and all five gates pass. The three
findings are follow-ups, not blockers.
