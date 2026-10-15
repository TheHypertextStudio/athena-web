'use client';

import { Checkbox, Skeleton, Text } from '@docket/ui/primitives';
import type { ISOWeekday, WorkingWeekdays } from '@docket/work/work-template-blueprint';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';
import { QueryLoadFailure } from '@/components/feedback';
import { api } from '@/lib/api';
import type { WorkspaceSettingsOut } from '@/lib/contracts/organization';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';
import { SettingRowStatus } from './setting-row-status';

const WEEKDAYS: readonly { readonly day: ISOWeekday; readonly name: string }[] = [
  { day: 1, name: 'Monday' },
  { day: 2, name: 'Tuesday' },
  { day: 3, name: 'Wednesday' },
  { day: 4, name: 'Thursday' },
  { day: 5, name: 'Friday' },
  { day: 6, name: 'Saturday' },
  { day: 7, name: 'Sunday' },
];

/** Workspace-owned calendar field; permission is the General page's live management decision. */
export interface WorkspaceWorkingWeekdaysProps {
  readonly orgId: string;
  readonly canEdit: boolean;
}

/** Edit the workspace's nonempty working calendar through the existing settings query and mutation. */
export function WorkspaceWorkingWeekdays({
  orgId,
  canEdit,
}: WorkspaceWorkingWeekdaysProps): JSX.Element {
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const key = queryKeys.settings(orgId, 'work-structure');
  const definition = apiQueryOptions(
    key,
    () => api.v1.orgs[':orgId'].settings['work-structure'].$get({ param: { orgId } }),
    'Could not load the working calendar.',
  );
  const settings = useLiveApiQuery(definition, 15_000);
  const [draft, setDraft] = useState<WorkingWeekdays | null>(null);
  const save = useApiMutation<WorkspaceSettingsOut, WorkingWeekdays>({
    mutationFn: (workingWeekdays) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].settings['work-structure'].$patch({
            param: { orgId },
            json: { workingWeekdays },
          }),
        'Could not save the working calendar.',
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(definition.queryKey, saved);
      setDraft(null);
    },
    onError: () => {
      setDraft(null);
    },
    invalidateKeys: [key],
  });

  if (settings.isError) return <QueryLoadFailure title="Working calendar" query={settings} />;
  if (settings.isPending) return <Skeleton className="h-24" />;
  const days = draft ?? settings.data.workingWeekdays;
  return (
    <fieldset aria-describedby={descriptionId} className="flex flex-col gap-3">
      <Text as="legend" token="label-large">
        Working weekdays
      </Text>
      <Text as="p" token="body-small" tone="muted" id={descriptionId}>
        Choose at least one day. Templates count working-day offsets using this workspace calendar.
        Changes apply to new work and future date changes; saved dates stay until then.
      </Text>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WEEKDAYS.map(({ day, name }) => (
          <label key={day} className="text-body-medium coarse:min-h-10 flex items-center gap-2">
            <Checkbox
              checked={days.includes(day)}
              disabled={!canEdit || save.isPending || (days.length === 1 && days.includes(day))}
              onChange={() => {
                const next = days.includes(day)
                  ? days.filter((value) => value !== day)
                  : [...days, day].sort((a, b) => a - b);
                if (next.length === 0) return;
                setDraft(next);
                save.mutate(next);
              }}
            />
            {name}
          </label>
        ))}
      </div>
      <SettingRowStatus pending={save.isPending} saved={save.isSuccess} />
    </fieldset>
  );
}
