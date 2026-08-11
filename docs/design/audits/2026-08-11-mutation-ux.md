# Design review: Mutation UX — 2026-08-11

**Surface register:** App — calm, dense, fast, keyboard-first.

**Scope:** The Project Tasks inline-create flow and the service-worker update card were reviewed
live. The broader mutation inventory is code-evidenced because it spans many routes rather than one
visual surface.

**Standard screenshots:**

- `screenshots/2026-08-11-mutation-ux/project-tasks-1440x900-light.png`
- `screenshots/2026-08-11-mutation-ux/project-tasks-1440x900-dark.png`
- `screenshots/2026-08-11-mutation-ux/project-tasks-390x844-light.png`
- `screenshots/2026-08-11-mutation-ux/project-tasks-390x844-dark.png`

**Meaningful states:**

- `screenshots/2026-08-11-mutation-ux/project-tasks-pending-create-1440x900-light.png`
- `screenshots/2026-08-11-mutation-ux/update-card-ready-1440x900-light.png`
- `screenshots/2026-08-11-mutation-ux/update-card-ready-1440x900-dark.png`
- `screenshots/2026-08-11-mutation-ux/update-card-after-click-stalled-1440x900-light.png`

| Dimension                         | Score | Evidence                                                                                                                                                                                                                              |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | Both reviewed surfaces use the calm Plex/MD3 app register. Labels are direct and domain-appropriate.                                                                                                                                  |
| 2. Typographic craft              |     3 | Project hierarchy, tabs, task rows, and sidebar cards use the canonical type scale with clear structural weight.                                                                                                                      |
| 3. Spatial rhythm & density       |     3 | The Project Tasks layout keeps a consistent 4px-derived rhythm at both widths; the dense task rows remain scannable.                                                                                                                  |
| 4. Hierarchy & information design |     3 | Inline add is visually adjacent to the task roster while “Add task with details” remains a secondary path. The update card is appropriately docked outside the work surface.                                                          |
| 5. Color discipline               |     3 | Both themes use neutral surfaces and semantic tokens. The update card earns its tonal emphasis without introducing decorative color.                                                                                                  |
| 6. Motion & feedback              |     1 | The delayed inline create disables and defocuses the field with no visible progress or queued row. The update card is pixel-identical before and after a stalled click; its text, enabled state, and ARIA state do not change.        |
| 7. States completeness            |     1 | Inline create has no pending-row treatment and surfaces no local failure. The update card has no applying state. Invalidate-only renames and broad pending flags leave other editors with snapback, lockout, or stale-response risks. |
| 8. Detail craft                   |     3 | Theme parity is strong, task rows remain aligned, and the measured 320px document width was exactly 320px with no horizontal overflow.                                                                                                |

**Gates:** A11y ❌ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

The A11y gate fails because an accepted update receives no `aria-busy` or changed live-region copy,
and the delayed inline create disables the focused field without an explanation, moves focus away,
and does not restore it after failure. Both controls are keyboard reachable before their pending
state.

## Runtime evidence

- The service-worker update is mechanically connected. `applyUpdate` posts `SKIP_WAITING`
  (`apps/web/src/components/service-worker-provider.tsx:184`), the worker calls `skipWaiting`
  (`packages/service-worker/src/worker/sw.ts:174`), activation claims the page
  (`packages/service-worker/src/worker/sw.ts:100`), and `controllerchange` reloads it
  (`apps/web/src/components/service-worker-provider.tsx:115`). A four-second fallback reload exists.
- In a deliberately stalled handshake, the update control measured the same before and after click:
  `{ text: "Update ready", disabled: false, ariaBusy: null }`. The two light-theme screenshots are
  therefore intentionally visually identical.
- With the task POST delayed, the inline field measured
  `{ disabled: true, value: "Write another follow-up brief", active: false }`. After a simulated 503
  it measured `{ disabled: false, value: "Write another follow-up brief", active: false }`—the draft
  survives, but focus and flow do not.
- The focused behavior suites passed: 13/13 web tests for the update provider and quick-add row, and
  5/5 worker-handshake tests. The current tests prove the handshake but explicitly pin the unchanged
  update card and do not exercise latency or rapid-fire task creation.

## Findings, ordered by severity

1. **P0 — Inline task entry serializes the person behind the network.**
   `QuickAddTaskRow` sets `adding`, awaits `onAdd`, and disables the input
   (`apps/web/src/components/tasks/quick-add-task-row.tsx:38`). Project and Cycle hosts return an
   invalidate-only `mutateAsync`; shared mutation settlement also awaits refetch. The composer must
   accept the next title immediately while each submitted title is represented separately as
   pending, successful, or retryable.
2. **P1 — The functional update control presents a dead click.** The card deliberately stays visible
   until reload but has no applying state, repeat-click guard, changed label, or live-region update
   (`apps/web/src/components/service-worker-provider.tsx:198` and `:223`). Safety does not require
   perceptual silence.
3. **P1 — Known-value renames are invalidate-only.** `useRenameTask` has no optimistic write or
   rollback (`apps/web/src/lib/use-rename-task.ts:30`), and equivalent list-page mutations exist for
   Projects, Programs, Initiatives, and Cycles. This contradicts the data-layer rule that renames are
   always optimistic.
4. **P1 — Whole-record optimism is unsafe under overlapping changes.** Task, Project, Program,
   Initiative, and Cycle mutations snapshot and restore whole records. An older failure can roll back
   a newer edit, while an older success can adopt stale fields over newer optimistic values.
5. **P1 — Await-then-clear composers can erase newer drafts.** Subtasks, comments, entity updates,
   and URL attachments leave editing available during the request, then clear the current field when
   an older submission resolves. Settlement must remove only the draft captured by that submission.
6. **P1 — Milestone editing combines global lockout with invalidate-only writes.** One pending flag
   disables every milestone control and the quick-add path; a failed create can also lose its draft.
7. **P2 — Full create composers disable unrelated drafting.** Duplicate-submit protection is valid;
   freezing context pickers and the next draft is not.
8. **P2 — Some settings imitate optimism without rollback.** Local state changes immediately, every
   choice is disabled during save, and a rejected request can leave the visible and persisted values
   divergent.

## Prevention requirements for the design phase

- Every mutation declares an interaction class: known-value optimistic edit, pending insert, or
  explicitly server-confirmed operation with a documented reason.
- Optimistic edits use field-scoped version ownership so out-of-order success or failure cannot
  overwrite a newer intent.
- Pending inserts capture the submitted draft, clear and refocus the composer immediately, render a
  pending row, and preserve a retryable failure without blocking the next submission.
- Submission settlement may clear only the draft token it owns.
- Long-running or transition operations acknowledge the click within 100ms with changed visible and
  accessible state while suppressing only duplicate activation.
- Deferred-promise behavior tests and a source-policy check enforce these contracts.

**Verdict: BELOW BAR.** Motion/feedback and states completeness score 1, and the A11y hard gate is
red. The visual shell is crafted; the mutation interaction model is not yet shippable.
