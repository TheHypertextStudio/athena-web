# Task-description edit-session design

**Date:** 2026-08-09
**Status:** Approved

## Objective

Make a continuous task-description edit produce one meaningful persisted change and therefore one
activity entry, instead of recording partial sentences after every brief typing pause.

## Persistence boundary

The fix belongs at the client autosave boundary. The task audit ledger is deliberately append-only,
and the Stream announces each mutation once; mutating recent ledger rows or grouping them only at
render time would weaken history while leaving the repeated PATCH requests in place.

Task freeform documents use a 2,000ms trailing quiet period. Every edit updates the local draft
immediately and resets that timer. When the full quiet period elapses, the latest draft is trimmed,
normalized to `null` when empty, and saved once if it differs from the persisted baseline. The
value before the editing session and the final settled value are therefore the server-side diff.

Blur ends the editing session and flushes a dirty draft immediately. Unmount also flushes the
latest dirty draft so in-app navigation does not discard a pending edit. A timer and a flush can
never save the same draft twice: flushing cancels the pending timer and records the value as sent.
When a successful mutation advances the persisted baseline, the hook recognizes the matching
draft as clean and does not begin another cycle.

## Component boundary and data flow

`useDebouncedAutosave` remains the shared equality, timer, and latest-value seam. It gains an
explicit flush operation rather than teaching individual editors to duplicate timer bookkeeping.
Existing consumers keep their current 600ms default unless they opt into another delay.

`EditableFreeformText` opts into 2,000ms and calls the returned flush operation when focus leaves
the whole editor wrapper. Focus moving between descendants does not end the session: blur flushes
only when `relatedTarget` is outside the wrapper. Its unmount cleanup uses the same idempotent flush
path. Task pages continue to pass the final value through `EntityDocument` to `patchTask`; no API or
audit schema changes are needed.

## Concurrency and failure behavior

Only the latest local draft is flushed. An in-flight save does not disable editing. A later edit
starts a new debounce cycle against the newest known baseline, preserving the existing optimistic
mutation behavior. If a mutation fails, application-owned error copy remains visible through the
current task mutation hook and the draft remains on screen; no provider or exception text is
rendered.

Browser process termination cannot guarantee completion of an ordinary asynchronous PATCH. This
design guarantees the requested immediate flush for focus changes and in-app React unmounts; it
does not claim durable delivery after a force-quit or network loss.

## Testing and validation

Fake-timer tests will prove that rapid edits within two seconds produce no intermediate save, the
final value saves once after two seconds, blur flushes without waiting, descendant focus movement
does not flush, unmount flushes once, a later timer cannot duplicate a flushed value, unchanged
values never save, and a matching baseline update ends the cycle. The task detail integration test
will prove that its description still reaches the PATCH mutation as the normalized final value.
API activity tests already prove one PATCH creates one resolved audit change; the implementation
will run that existing suite rather than alter append-only ledger behavior.
