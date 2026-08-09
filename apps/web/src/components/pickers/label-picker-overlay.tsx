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
 */
import type { LabelCreate, LabelOut } from '@docket/types';
import { LabelId } from '@docket/types';
import { PickerList, type PickerOption } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, Skeleton } from '@docket/ui/primitives';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';
import { type QueryClient, useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';

import { objectKey } from '@/lib/actions';
import { api } from '@/lib/api';
import { labelOptions } from '@/components/pickers/options';
import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import { taskDetailDef } from '@/lib/use-task-detail';
import { queryKeys, unwrap, useApiListQuery } from '@/lib/query';

import type { LabelPickerRequest } from './picker-overlay';

/** Props for {@link LabelPickerOverlay}. */
export interface LabelPickerOverlayProps {
  readonly request: LabelPickerRequest;
  readonly onClose: () => void;
}

/** Write one task's label set and invalidate everything it can change. */
async function applyLabelsToTask(
  orgId: string,
  taskId: string,
  labelIds: readonly string[],
  queryClient: QueryClient,
): Promise<void> {
  await unwrap(
    () =>
      api.v1.orgs[':orgId'].tasks[':id'].$patch({
        param: { orgId, id: taskId },
        json: { labels: labelIds.map((id) => LabelId.parse(id)) },
      }),
    'Could not update labels.',
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, taskId) });
  void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'task-graph'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(orgId) });
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

  const resolvedCurrent = useMemo<ReadonlyMap<string, readonly string[]> | null>(() => {
    if (suppliedCurrent) return suppliedCurrent;
    if (!needsFetch) return new Map();
    if (detailResults.some((r) => r.data === undefined)) return null;
    const map = new Map<string, readonly string[]>();
    objects.forEach((o, index) => {
      const task = detailResults[index]?.data;
      map.set(objectKey(o), task ? task.labels.map((l) => l.id) : []);
    });
    return map;
  }, [suppliedCurrent, needsFetch, detailResults, objects]);

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

  const applyToggle = useCallback(
    (labelId: string) => {
      if (localCurrent === null) return;
      const applyToAll = !checkedIds.includes(labelId);
      const next = new Map(localCurrent);
      for (const o of objects) {
        const key = objectKey(o);
        const objectLabels = localCurrent.get(key) ?? [];
        const has = objectLabels.includes(labelId);
        if (applyToAll === has) continue;
        const updated = applyToAll
          ? [...objectLabels, labelId]
          : objectLabels.filter((id) => id !== labelId);
        next.set(key, updated);
        void applyLabelsToTask(orgId, o.id, updated, queryClient);
      }
      setLocalCurrent(next);
    },
    [localCurrent, checkedIds, objects, orgId, queryClient],
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

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent>
        {localCurrent === null ? (
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
