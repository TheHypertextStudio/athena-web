'use client';

import type {
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesLifecycle,
  RecurrenceSeriesOut,
  SeriesEdit,
} from '@/lib/contracts/recurrence';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import type { TaskRepeatDraft } from './repeat-task-control';
import { nextRevisionBoundary, processTrigger, repeatDraft } from './series-management-values';

/** Management identity and dismissal state shared by the route and overlay. */
export interface SeriesManagementOptions {
  readonly orgId: string;
  readonly seriesId: string;
  readonly onDraftStateChange?: ((dirty: boolean, busy: boolean) => void) | undefined;
}

/** Own the persisted series and a schedule draft that survives unrelated query refreshes. */
export function useSeriesManagement({
  orgId,
  seriesId,
  onDraftStateChange,
}: SeriesManagementOptions) {
  const key = queryKeys.recurrenceSeriesDetail(orgId, seriesId);
  const detailQ = useApiQuery(
    apiQueryOptions(
      key,
      () =>
        api.v1.orgs[':orgId']['recurrence-series'][':id'].$get({ param: { orgId, id: seriesId } }),
      'Could not load this repeating work.',
    ),
  );
  const detail = detailQ.data ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const earliestEffectiveFrom = nextRevisionBoundary(today, detail?.revisions ?? []);
  const [changedDraft, setDraft] = useState<TaskRepeatDraft | null>(null);
  const [changedEffectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const persistedDraft = detail ? repeatDraft(detail.trigger) : null;
  const draft = changedDraft ?? persistedDraft;
  const effectiveFrom = changedEffectiveFrom ?? earliestEffectiveFrom;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(persistedDraft) ||
    effectiveFrom !== earliestEffectiveFrom;
  const { lifecycle, edit } = useSeriesMutations(orgId, seriesId, () => {
    setDraft(null);
    setEffectiveFrom(null);
  });
  const busy = lifecycle.isPending || edit.isPending;
  useEffect(() => {
    onDraftStateChange?.(dirty, busy);
  }, [dirty, busy, onDraftStateChange]);
  const occurrences = detail?.occurrences ?? [];
  const groups = {
    needsAttention: occurrences.filter((value) => value.status === 'needs_resolution'),
    upcoming: occurrences.filter(
      (value) => value.scheduledFor >= today && ['expected', 'materialized'].includes(value.status),
    ),
    history: occurrences.filter(
      (value) =>
        value.scheduledFor < today ||
        !['expected', 'materialized', 'needs_resolution'].includes(value.status),
    ),
  };
  const saveSchedule = (): void => {
    if (!draft) return;
    const trigger = processTrigger(draft);
    if (trigger) edit.mutate({ scope: 'future', effectiveFrom, trigger });
  };
  return {
    orgId,
    detailQ,
    detail,
    today,
    draft,
    setDraft,
    effectiveFrom,
    setEffectiveFrom,
    earliestEffectiveFrom,
    lifecycle,
    edit,
    groups,
    saveSchedule,
    busy,
  };
}

/** State consumed by the focused management regions. */
export type SeriesManagementState = ReturnType<typeof useSeriesManagement>;

function useSeriesMutations(orgId: string, seriesId: string, onScheduleSaved: () => void) {
  const key = queryKeys.recurrenceSeriesDetail(orgId, seriesId);
  const lifecycle = useApiMutation<RecurrenceSeriesOut, RecurrenceSeriesLifecycle>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'][':id'].lifecycle.$post({
            param: { orgId, id: seriesId },
            json,
          }),
        'Could not change this repeating work.',
      ),
    failureTitle: 'Could not change this repeating work.',
    invalidateKeys: [key, queryKeys.recurrenceSeries(orgId)],
    awaitInvalidation: true,
  });
  const edit = useApiMutation<RecurrenceSeriesDetailOut, SeriesEdit>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'][':id'].edits.$post({
            param: { orgId, id: seriesId },
            json,
          }),
        'Could not update future occurrences.',
      ),
    failureTitle: 'Could not update this repeating work.',
    invalidateKeys: [key, queryKeys.recurrenceSeries(orgId)],
    awaitInvalidation: true,
    onSuccess: (_data, variables) => {
      if (variables.scope === 'future') {
        onScheduleSaved();
      }
    },
  });
  return { lifecycle, edit };
}
