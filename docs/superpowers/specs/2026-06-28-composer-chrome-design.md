# Composer Chrome Cleanup — Design

> **Date**: 2026-06-28
> **Status**: Proposed
> **Scope**: All create composers (task, project, program, initiative, cycle, team)

## Objective

The create composers carry too much self-referential, obvious chrome. The UI does not
need to tell the user they are creating a new task — that is the whole point of the
dialog they just opened. Strip the redundant text, lighten the property pills so they
read as inline metadata rather than a wall of buttons, give the dialog room to breathe,
and make the description input blend in (no browser resize grip).

This is a visual/markup refactor only. No data flow, validation, API, or behavior
changes beyond the description field's auto-grow.

## Problems (observed)

1. **Self-referential text.** The dialog renders a `"New task"` heading plus the line
   _"Give it a title, then set as much as you want now — or shape it later."_ Both
   restate what the user is obviously doing.
2. **Heavy property pills.** Every picker in the composer strip passes
   `triggerVariant="outline"` (`border + shadow-sm + bg-transparent`). On the dialog's
   elevated surface these read as chunky gray buttons.
3. **Dialog too small.** `DialogContent` is capped at `max-w-lg` (512px); the shell
   redundantly re-applies `max-w-lg`.
4. **Dirty input chrome.** The description `textarea` uses `resize-y`, exposing the
   diagonal `//` resize grip in the corner. It should blend into the dialog.

## Approach

Make the changes in the shared layer so every composer inherits them:

- `apps/web/src/components/composer/composer-shell.tsx` — the dialog chrome, title
  input, description textarea, footer, and `PropertyStrip` wrapper.
- `packages/ui/src/components/pickers/PropertyTrigger.tsx` — already supports a quiet
  borderless `ghost` weight; no change needed there, we just stop opting into `outline`.
- `apps/web/src/components/tasks/task-form-pickers.tsx` and the sibling composer
  picker files — stop passing `triggerVariant="outline"`.
- `apps/web/src/components/teams/team-picker.tsx` — switch its trigger from `outline`
  to the same quiet treatment.

## Changes

### 1. Remove self-referential chrome — `composer-shell.tsx`

- Render `DialogTitle` as `sr-only`: the accessible name is preserved for screen
  readers, but nothing visible. The large title input is the de facto heading.
- Stop rendering the visible `DialogDescription`. Pass `aria-describedby={undefined}`
  to `DialogContent` when no description is supplied so Radix does not warn.
- Stop passing `description=` from the composers (task, project, etc.).
- Drop the leading `Plus` icon on the submit button. Footer keeps `Cancel` and the
  `Create task` / `Creating…` label only.

The `heading` prop stays in `ComposerShellProps` (it becomes the sr-only accessible
title). The `description` prop stays optional but is no longer used by callers.

### 2. Quiet the property pills

- In each composer's picker file, remove `triggerVariant="outline"`. The pickers fall
  back to `PropertyTrigger`'s borderless `ghost` base: no border, no shadow — icon +
  label only. Set values render `text-on-surface`; empty prompts stay muted with the
  small `+` glyph.
- **Hover visibility fix.** `ghost`'s hover background is `surface-container-high`,
  which equals the dialog background → invisible. Fix at one point: `PropertyStrip`
  (in `composer-shell.tsx`) adds a descendant hover override
  `[&_button:hover]:bg-surface-container-highest` so every chip hovers to a visible
  step up. A descendant selector (`.strip button:hover`, specificity 0,2,1) wins over
  the ghost class's `:hover` (0,2,0), so it reliably applies.
- `TeamPicker` switches its `Button` from `variant="outline"` to `variant="ghost"`
  (size `sm` / `h-8`), keeping the `Users` + `ChevronDown` glyphs muted. It sits inside
  `PropertyStrip`, so it inherits the same hover override.

### 3. Widen the dialog — `composer-shell.tsx`

- `DialogContent className="max-w-lg"` → `max-w-2xl` (672px). Stays responsive via the
  primitive's existing `w-[calc(100%-2rem)]`.

### 4. Auto-grow description input — `composer-shell.tsx`

- `resize-y` → `resize-none` (removes the grip).
- Auto-grow: a `ref` on the textarea + a `useLayoutEffect` keyed on `body` that sets
  `height = 'auto'` then `height = scrollHeight`. Starts at a comfortable min-height
  (`min-h-[6rem]`) and caps with a `max-h-[40vh]` + `overflow-y-auto` for very long
  input. Height recomputes when the dialog reopens (the host clears `body` on close).
- Keep the hairline divider above the `PropertyStrip` — it is a subtle group separator,
  not chrome, and with the lighter pills it reads as structure.

## Files to modify

- `apps/web/src/components/composer/composer-shell.tsx` — heading sr-only, drop
  description + submit Plus, widen dialog, auto-grow textarea, strip hover override.
- `apps/web/src/components/tasks/task-form-pickers.tsx` — drop `triggerVariant="outline"`.
- `apps/web/src/components/teams/team-picker.tsx` — quiet ghost trigger.
- Sibling composer picker files (project / program / initiative / cycle / team) that
  pass `triggerVariant="outline"` — drop it. (Exact list confirmed during the plan via
  a grep for `triggerVariant="outline"` and `description=` on `ComposerShell`.)
- Composer call sites passing `description=` to `ComposerShell` — remove that prop.

## Out of scope

- No copy changes to the trigger buttons that open the dialog ("New task" + `Plus` in
  the page header stays — that is an action label, not in-dialog chrome).
- No changes to the detail-screen property rows (they already use the quiet `ghost`
  trigger on a different surface where its hover is visible).
- No new picker variant in the `Button` CVA; the existing `ghost` weight plus the
  one-line strip hover override is enough.

## Accessibility

- Dialog keeps an accessible name via the `sr-only` `DialogTitle`.
- No `aria-describedby` dangling reference once the visible description is removed.
- Property chips keep their `aria-label`s (unchanged) and the shared focus ring.

## Validation

- `pnpm typecheck` and `pnpm lint` clean.
- Update/confirm any composer-shell or create-task component tests still pass (the
  `"New task"` heading and description strings will no longer be in the DOM as visible
  text; tests asserting on them, if any, get updated to query the title input / role).
- Browser check (both themes, narrow + wide): dialog opens to a roomy title field,
  quiet inline property row with visible hover, clean auto-growing description with no
  resize grip, and no "New task" / description chrome.
