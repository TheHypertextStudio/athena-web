# Error presentation

> **Reader**: an engineer whose surface has something to say when a read or a write fails. After
> reading, you should know which of four primitives the situation calls for, where the copy comes
> from, and what is banned.
> **Status**: primitives shipped 2026-09-18 (`ERRORS-001`); site migration in progress. Design:
> `docs/superpowers/specs/2026-09-18-drafting-errors-canvas-task-detail-design.md`, Part 2. The
> copy contract this builds on is `data-layer.md` §2.7.

A failure is presented in exactly one of four ways, chosen by what happened, never by where the
code happens to be. Nothing in product code paints error state on its own: no `text-error` class,
no hand-rolled `role="alert"`, no red paragraph between two controls.

## The taxonomy

| Situation                                                                | Primitive                                                 | Where it appears               | Copy source                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| A value in one control is invalid, before or after a write               | `Field error=` or `FieldError` (`@docket/ui`)             | Under that control             | An application-owned string                  |
| A write, action, dialog submit, inline edit, or optimistic change failed | A notice: `useApiMutation`'s default, or `presentFailure` | The notice stack, bottom-right | `failurePresentation` (code and status only) |
| A region could not load and has nothing to show                          | `LoadFailure` (`components/feedback`)                     | In place of the region         | `failurePresentation` and `failureAction`    |
| Part of a page failed while rows are still usable                        | `InlineBanner tone="critical"` with an action             | Above the rows, in flow        | An application-owned string                  |
| A list inside an overlay (picker, palette) failed                        | `InlineBanner density="compact"`                          | Inside the overlay             | An application-owned string                  |
| A write the offline queue has taken                                      | A neutral notice, from `useApiMutation`                   | The notice stack               | Fixed copy                                   |
| The route itself crashed                                                 | The route's `error.tsx`                                   | The content region             | Fixed copy                                   |

The field case is the one sanctioned inline error, because it is about the control directly above
it. Everything else leaves the flow of the page: a failed action becomes a notice, a failed read
becomes the region's state.

## The primitives

- **`Toaster`** (`@docket/ui`) mounts once in `apps/web/src/components/providers.tsx`. Notices stack
  bottom-right, stay clickable while a dialog is open, and are limited to three on screen.
- **`notify` / `notifyFailure`** (`@docket/ui`) take a `ToastNotice`: title, optional detail, tone, at
  most one action (`onSelect` or `href`), an optional `dedupeKey`. The type has no slot for an
  `Error`; copy is resolved before it gets here. Notices sharing a key replace each other.
- **`presentFailure(error, fallbackTitle, { retry? })`** (`components/feedback`) is the one path from a
  caught failure to a notice. It reads no `.message`: `failurePresentation` branches on the failure's
  stable problem code and HTTP status, so a 403 offers the destination that resolves it and a 500
  offers "Try again". The key is the code, so a poll that keeps failing shows one card.
- **`useApiMutation`** presents every rejected write this way by default, after the caller's
  `onError` so an optimistic rollback runs first, with "Try again" re-issuing the same variables.
  `failure: 'silent'` is for a caller that owns presentation, such as a field-attributable
  validation failure; `failureTitle` names the operation for a failure that carries no code.
- **`LoadFailure({ title, error, onRetry?, retrying?, size? })`** renders what happened and the
  action that resolves it, on `EmptyState tone="critical"`. Retry is offered only when it could work;
  a refusal gets a link to the place that can change the answer, so the state is never a dead end.
  `size="panel"` fits a rail or a card.
- **`InlineBanner`** keeps a partial failure in the page beside the rows a person can still use;
  `density="compact"` fits an overlay list.
- **`FieldError`** is `Field`'s own error line, exported for a control `Field` cannot wrap.

## What is banned

- Rendering exception text, a provider's `error_description`, or a Problem `detail`. The workspace
  policy test forbids reading `.message` in product code; the primitives above never do.
- One generic sentence per operation ("Could not save."). Branch on the problem code; say what
  happened and what to do.
- Painting error state by hand: `text-error`, `bg-error`, `border-error`, or an intrinsic element
  with `role="alert"` outside `@docket/ui` and `components/feedback`. An ESLint rule enforces this
  once the migration completes.
- A local `error` `useState` plus a red paragraph for a mutation. Delete both; the mutation
  presents itself.
