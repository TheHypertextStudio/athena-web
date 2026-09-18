# Composer drafts

> **Reader**: an engineer changing how a create composer saves, offers, or resumes what a person
> typed, or adding a composer that should keep drafts. After reading, you should know where a draft
> lives, which module owns each rule, how the composer writes without a Save button, and what each
> answer to the close prompt does.
> **Status**: shipped 2026-09-18 (`DRAFTS-001`). Design:
> `docs/superpowers/specs/2026-09-18-drafting-errors-canvas-task-detail-design.md`, Part 1.

A composer draft is the unsent state of one of the five global create composers: task, project,
initiative, program, and team. It is kept on the server so a person can close the composer, reload,
or change device and pick the draft back up. The behaviour follows Linear's: closing a composer with
typed text asks whether to save the draft, saved drafts are listed on a Drafts page reachable from the
sidebar, and a draft expires six months after its last edit.

## Ownership

| Concern                                   | Module                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contracts (kind, per-kind payloads, DTOs) | `domains/work/src/contracts/composer-draft.ts`                                                 |
| Table                                     | `packages/db/src/schema/composer-draft.ts` (`composer_draft`, migration 0134)                  |
| Store: load, list, create, patch, delete  | `apps/api/src/lib/composer-draft/store.ts`                                                     |
| Personal routes                           | `apps/api/src/routes/me-drafts.ts` → `/v1/me/drafts`                                           |
| Expiry sweep                              | `apps/api/src/routes/composer-draft-sweep.ts`, `POST /cron/expired-drafts-sweep`, daily        |
| Resume preference                         | `domains/planning/src/contracts/hub-preferences.ts` (`composer.resumeDrafts`), `routes/hub.ts` |
| Web reads, writes, and cache              | `apps/web/src/lib/drafts/defs.ts`                                                              |
| Autosave and the row's life               | `apps/web/src/components/composer/use-composer-draft-persistence.ts`                           |
| Per-composer codecs                       | `apps/web/src/components/<kind>s/<kind>-draft-codec.ts`                                        |
| Chip and close prompt                     | `apps/web/src/components/composer/composer-drafts-chip.tsx`, `composer-close-prompt.tsx`       |
| Navigate-away pointer and resume          | `apps/web/src/components/create-object/create-object-provider.tsx`, `interrupted-draft.ts`     |
| Drafts page                               | `apps/web/src/app/(app)/drafts/`                                                               |
| Sidebar entry                             | `packages/ui/src/components/shell/navigation-catalog.tsx` (`home:drafts`, hidden at zero)      |
| Settings row                              | `apps/web/src/components/settings/composer-preferences-section.tsx`                            |

## The draft

A `composer_draft` row belongs to one person and one workspace and has one `kind`. Its `payload` is
that composer's own draft value, field for field, with every field optional: a half-filled form
round-trips without the server knowing which fields the form requires. The server validates the
shape, derives a `title` for lists from the payload's title or name, and never interprets the rest.
References inside a payload (assignee, project, labels, …) are the branded ids the pickers hold.

Every write carries the `revision` the writer last saw and is refused with `412 precondition_failed`
when it is stale. The composer holds the whole draft, so its rebase is a replay of the same payload
over whatever the server has now: last writer wins, which is the right answer for one person's own
draft open in two tabs. A draft of one kind cannot be rewritten as another (`422`).

`expires_at` is 183 days after the last edit and every write renews it. The sweep deletes expired
rows once a day; reads never return one, so a race with the sweep is invisible.

## Lifecycle

```
pristine ──typed text──▶ dirty ──600 ms quiet──▶ saved ──┬── Create ──────▶ committed (row deleted)
                                                        ├── Save draft ──▶ kept (row stays)
                                                        ├── Discard ─────▶ discarded (row deleted)
                                                        ├── navigate ────▶ kept, pointer written
                                                        └── 183 days ────▶ expired (swept)
```

- **Pristine → dirty.** The shell's rule: typed text in the title, summary, or body. Property picks
  alone never create a draft, so opening a composer and closing it leaves nothing behind.
- **Dirty → saved.** `useComposerDraftPersistence` runs the shared `useDebouncedAutosave` at 600 ms.
  The first write is a `POST` that creates the row; later writes `PATCH` it. Writes are queued behind
  one another, so a second keystroke during the create can never double-create. A failed save shows
  "Not saved" beside the actions and the next edit retries; nothing is queued client-side.
- **Create.** After the API creates the record and before the composer closes, it awaits `commit()`,
  which deletes the row. A "Create more" composer re-arms and starts a fresh draft for the next text.
- **Close prompt.** `Save draft` (the focused primary) flushes any pending write and keeps the row;
  `Discard` deletes it; `Keep editing` and a second Escape return to the form. A composer that does
  not keep drafts shows the older "Discard this draft?" prompt.
- **Navigate away.** Linear hides the modal and keeps a temporary draft. Here the row is already
  saved, so `CreateObjectProvider` closes the composer on a pathname change and writes an
  interrupted pointer `{ kind, draftId }` to `sessionStorage`. The next open of that kind reads and
  clears the pointer and reopens the draft, whatever the resume preference says.

## Resuming

A composer receives `resumeDraftId` once, on mount, from the first of: the request's `draftId` (the
Drafts page), the interrupted pointer, or, when `composer.resumeDrafts` is on, the newest draft of
that kind in the destination workspace. The host includes "drafts list settled" in its readiness only
when one of those applies, so the composer never mounts pristine and then jumps. Loading pours the
payload through the composer's `hydrate`, which drops references absent from the loaded option
rosters so a stale id never reaches the create call, and bumps the body editor's reset key so the
rich editor accepts the new document. Loading is not a write.

The preference is off by default and lives with the other personal preferences; the row is under
Settings → Profile → Creating.

## Surfaces

- **Chip.** Once a draft of this kind exists in this workspace, the action row shows "Drafts (n)".
  Choosing one replaces the composer's content; each row has a trailing delete.
- **Drafts page.** `/drafts` lists every draft across workspaces, grouped by kind in the workspace's
  vocabulary, newest first. Activating a row calls `openCreate` with the draft's workspace and id.
- **Sidebar.** `home:drafts` is resolved into the catalog only while `draftCount > 0`, and carries the
  count as its badge. The page, the badge, and every chip read one list query (`queryKeys.drafts()`),
  which the composers keep current as they save, so the three cannot disagree.

## Exclusions

`CreateCycleDialog` has no global host and `TemplateEditorDialog` edits a persisted template; neither
keeps drafts. Programs' nested "milestones" rows belong to the project payload and get fresh local keys
on hydrate.

## Testing

Contract round-trips in `domains/work/tests/composer-draft-contract.test.ts`; the API's create, list,
patch, 412, delete, filters, and sweep in `apps/api/tests/routes/me-drafts.test.ts`; the hook's debounce,
queue, rebase, answers, and resume in `apps/web/tests/composers/use-composer-draft-persistence.test.tsx`;
the chip and prompt in `composer-drafts-shell.test.tsx`; the page in `apps/web/tests/drafts/`; the
sidebar rule in `packages/ui/tests/components/shell/sidebar-drafts-destination.test.tsx`.
