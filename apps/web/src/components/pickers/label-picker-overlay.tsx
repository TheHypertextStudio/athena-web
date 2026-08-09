'use client';

/**
 * `components/pickers/label-picker-overlay` — the popover {@link PickerOverlayProvider} renders.
 *
 * @remarks
 * Mounts fresh per `open()` call (see `picker-overlay.tsx`'s `key`), so its "resolved current,
 * seeded once" local state and its anchor ref never need to react to a *different* request
 * arriving mid-session — a new request is a new mount.
 *
 * Checked state: a label reads as checked only when *every* target object currently carries it
 * (mirrors `LabelsPicker`'s own single-object summarization, extended to N). Toggling a label
 * moves the whole set toward the opposite of its current "all carry it" state: checking a
 * partially- or un-applied label applies it to every object that lacks it; unchecking a fully-
 * applied label removes it from every object that has it.
 *
 * Writes go through {@link useApiMutation} (not a bare fetch) so a failed PATCH gets the same
 * authentication-interlock recovery and offline-write queueing every other write in the app gets.
 * A toggle can touch more than one object; every changed object's write is attempted even if an
 * earlier one fails, and only the object(s) whose write actually failed revert their entry in
 * `localCurrent` — a sibling object's successful write is never undone just because another one
 * failed. The failure is surfaced inline (a `role="alert"` block, matching the command palette's
 * own error treatment), not silently dropped.
 *
 * Reads can fail too: a failed task-detail resolution (when the caller omits `current`) or a
 * failed labels-list fetch each render the same inline error instead of an endless skeleton or a
 * false "No labels" empty state.
 */
import type { LabelCreate, LabelOut, TaskOut } from '@docket/types';
import { LabelId } from '@docket/types';
import { PickerList, type PickerOption } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, Skeleton } from '@docket/ui/primitives';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';

import { objectKey } from '@/lib/actions';
import { api } from '@/lib/api';
import { labelOptions } from '@/components/pickers/options';
import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import { taskDetailDef } from '@/lib/use-task-detail';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiListQuery, useApiMutation } from '@/lib/query';

import type { LabelPickerRequest } from './picker-overlay';

/** Props for {@link LabelPickerOverlay}. */
export interface LabelPickerOverlayProps {
  readonly request: LabelPickerRequest;
  readonly onClose: () => void;
}

/** Copy shown when one task's label write fails. */
const WRITE_ERROR_FALLBACK = 'Could not update labels.';
/** Copy shown when a caller-omitted `current` could not be resolved from the task-detail read. */
const DETAIL_ERROR_FALLBACK = "Could not load these tasks' current labels.";
/** Copy shown when the org's label list itself failed to load. */
const LABELS_ERROR_FALLBACK = 'Could not load your labels.';

/** The shared error-banner markup, matching the command palette's own `role="alert"` block. */
function ErrorBanner({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
    >
      {message}
    </div>
  );
}

/** Variables for one task's label-set write. */
interface ApplyLabelsVariables {
  readonly taskId: string;
  readonly labelIds: readonly string[];
}

/**
 * Resolve where focus should land once the popover unmounts, since it is anchored via
 * `virtualRef` with no `PopoverTrigger` for Radix's default `onCloseAutoFocus` to fall back to
 * (which otherwise sends focus to `<body>`, dropping the person out of the grid entirely).
 *
 * @remarks
 * Prefers the anchor's enclosing `[role="grid"]` — the table the `L` hotkey fired from — so arrow
 * keys keep navigating the grid after Escape; falls back to the anchor element itself when there
 * is no enclosing grid (e.g. the right-click path, whose anchor may not sit inside an
 * `EntityTable`). Returns `null` when the anchor is not a real element (nothing to focus).
 */
export function resolveCloseFocusTarget(anchor: PopoverVirtualAnchor | null): HTMLElement | null {
  if (!(anchor instanceof HTMLElement)) return null;
  const grid = anchor.closest<HTMLElement>('[role="grid"]');
  return grid ?? anchor;
}

/** The popover {@link PickerOverlayProvider} mounts while a labels request is open. */
export function LabelPickerOverlay({ request, onClose }: LabelPickerOverlayProps): JSX.Element {
  const { organizationId: orgId, objects, current: suppliedCurrent } = request;
  const queryClient = useQueryClient();

  const labelsQ = useApiListQuery(labelsDef(orgId));
  const allLabels: readonly LabelOut[] = labelsQ.data?.items ?? [];
  const options = useMemo<readonly PickerOption[]>(() => labelOptions(allLabels), [allLabels]);

  const needsFetch = suppliedCurrent === undefined;
  const detailResults = useQueries({
    queries: needsFetch ? objects.map((o) => taskDetailDef(orgId, o.id)) : [],
  });
  const detailFailed = needsFetch && detailResults.some((r) => r.isError);

  const resolvedCurrent = useMemo<ReadonlyMap<string, readonly string[]> | null>(() => {
    if (suppliedCurrent) return suppliedCurrent;
    if (detailResults.some((r) => r.data === undefined)) return null;
    const map = new Map<string, readonly string[]>();
    objects.forEach((o, index) => {
      const task = detailResults[index]?.data;
      map.set(objectKey(o), task ? task.labels.map((l) => l.id) : []);
    });
    return map;
  }, [suppliedCurrent, detailResults, objects]);

  // Seeded exactly once per mount (this component remounts fresh per open() call — see
  // picker-overlay.tsx), then owned locally so sequential toggles in one open session compute
  // against what the popover has already applied, not a resolved snapshot that never refetches
  // mid-session.
  const [localCurrent, setLocalCurrent] = useState<ReadonlyMap<string, readonly string[]> | null>(
    null,
  );
  const seeded = useRef(false);
  if (!seeded.current && resolvedCurrent !== null) {
    seeded.current = true;
    setLocalCurrent(resolvedCurrent);
  }

  const checkedIds = useMemo<readonly string[]>(() => {
    if (localCurrent === null || objects.length === 0) return [];
    return options
      .map((o) => o.value)
      .filter((id) => objects.every((o) => (localCurrent.get(objectKey(o)) ?? []).includes(id)));
  }, [options, objects, localCurrent]);

  const [writeError, setWriteError] = useState<string | null>(null);

  const applyLabelsMutation = useApiMutation<TaskOut, ApplyLabelsVariables>({
    mutationFn: ({ taskId, labelIds }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: { labels: labelIds.map((id) => LabelId.parse(id)) },
          }),
        WRITE_ERROR_FALLBACK,
      ),
    onSuccess: (_updated, variables) => {
      // Per-task-id invalidation, since a single `useApiMutation` instance here writes N
      // different tasks across a session — `invalidateKeys` below is fixed at hook-creation time
      // and can't carry a variable taskId, so the fine-grained key is invalidated here instead.
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, variables.taskId) });
    },
    invalidateKeys: [['org', orgId, 'task-graph'], queryKeys.tasks(orgId)],
  });

  const applyToggle = useCallback(
    (labelId: string) => {
      if (localCurrent === null) return;
      const applyToAll = !checkedIds.includes(labelId);
      const next = new Map(localCurrent);
      const writes: {
        key: string;
        taskId: string;
        previous: readonly string[];
        updated: readonly string[];
      }[] = [];
      for (const o of objects) {
        const key = objectKey(o);
        const objectLabels = localCurrent.get(key) ?? [];
        const has = objectLabels.includes(labelId);
        if (applyToAll === has) continue;
        const updated = applyToAll
          ? [...objectLabels, labelId]
          : objectLabels.filter((id) => id !== labelId);
        next.set(key, updated);
        writes.push({ key, taskId: o.id, previous: objectLabels, updated });
      }
      setLocalCurrent(next);
      setWriteError(null);
      // Every changed object's write is attempted, even once an earlier one has already failed —
      // only the object(s) whose own write failed revert; a sibling's successful write stays
      // applied.
      void Promise.all(
        writes.map(async ({ key, taskId, previous, updated }) => {
          try {
            await applyLabelsMutation.mutateAsync({ taskId, labelIds: updated });
          } catch (error) {
            setLocalCurrent((current) => {
              if (current === null) return current;
              const reverted = new Map(current);
              reverted.set(key, previous);
              return reverted;
            });
            setWriteError(userErrorMessage(error, WRITE_ERROR_FALLBACK));
          }
        }),
      );
    },
    [localCurrent, checkedIds, objects, applyLabelsMutation],
  );

  const createLabel = useCreateLabel(orgId);
  const onCreate = useCallback(
    (name: string) => {
      const input: LabelCreate = { name };
      createLabel.mutate(input, {
        onSuccess: (created) => {
          applyToggle(created.id);
        },
      });
    },
    [createLabel, applyToggle],
  );

  // Computed once at mount (this component remounts fresh per open() call), matching the timing
  // Radix needs to measure the popover's initial position correctly.
  const anchorRef = useRef<PopoverVirtualAnchor | null>(
    request.anchor ??
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );

  const readError = detailFailed
    ? userErrorMessage(detailResults.find((r) => r.isError)?.error, DETAIL_ERROR_FALLBACK)
    : labelsQ.isError
      ? userErrorMessage(labelsQ.error, LABELS_ERROR_FALLBACK)
      : null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        onCloseAutoFocus={(event) => {
          // Radix's default behavior refocuses a `PopoverTrigger` — there isn't one here (this
          // popover is anchored via `virtualRef`), so left alone focus would fall through to
          // `<body>` and drop keyboard navigation out of the grid entirely.
          event.preventDefault();
          resolveCloseFocusTarget(anchorRef.current)?.focus();
        }}
      >
        {writeError ? <ErrorBanner message={writeError} /> : null}
        {readError ? (
          <ErrorBanner message={readError} />
        ) : localCurrent === null ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        ) : (
          <PickerList
            options={options}
            selected={checkedIds}
            onSelect={applyToggle}
            multiple
            searchPlaceholder="Filter labels…"
            emptyText="No labels"
            ariaLabel="Labels"
            create={{
              render: (q) => `Create "${q}"`,
              canCreate: (q, opts) =>
                !opts.some((o) => o.label.trim().toLowerCase() === q.trim().toLowerCase()),
              onCreate,
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
