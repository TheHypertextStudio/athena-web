'use client';

/** Focused calendar-drawer control for applying a reusable process to event occurrences. */
import type {
  CalendarItemOut,
  CalendarProcessBindingOut,
  ProcessDefinitionSummaryOut,
} from '@docket/types';
import { Button, Select } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, type SubmitEventHandler, useEffect, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiListQuery,
  useApiMutation,
} from '@/lib/query';

/** Props for {@link PlanWorkForEventForm}. */
export interface PlanWorkForEventFormProps {
  /** Calendar item whose occurrence or provider series receives generated work. */
  readonly item: CalendarItemOut;
  /** Close the compact setup after canceling. */
  readonly onDone: () => void;
}

/** Choose a workspace process and create one stable event-to-series binding. */
export function PlanWorkForEventForm({ item, onDone }: PlanWorkForEventFormProps): JSX.Element {
  const { activeOrgId, orgs } = useActiveOrg();
  const [organizationId, setOrganizationId] = useState(activeOrgId ?? orgs[0]?.id ?? '');
  const [definitionId, setDefinitionId] = useState('');
  const [created, setCreated] = useState<CalendarProcessBindingOut | null>(null);
  const definitions = useApiListQuery(
    apiQueryOptions(
      queryKeys.processDefinitions(organizationId),
      () =>
        api.v1.orgs[':orgId']['process-definitions'].$get({
          param: { orgId: organizationId },
        }),
      'Could not load reusable work.',
      { enabled: organizationId.length > 0, staleTime: STALE.static },
    ),
  );
  const options = definitions.data?.items ?? [];
  const selectedDefinition =
    options.find((option) => option.id === definitionId) ?? options[0] ?? null;

  useEffect(() => {
    if (options.some((option) => option.id === definitionId)) return;
    setDefinitionId(options[0]?.id ?? '');
  }, [definitionId, options]);

  const bind = useApiMutation<CalendarProcessBindingOut, undefined>({
    mutationFn: () => {
      if (!selectedDefinition) throw new Error('Choose reusable work for this event.');
      return unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series']['calendar-bindings'].$post({
            param: { orgId: organizationId },
            json: {
              calendarItemId: item.id,
              processDefinitionId: selectedDefinition.id,
            },
          }),
        item.recurringEventId
          ? 'Could not add tasks for each event.'
          : 'Could not plan work around this event.',
      );
    },
    invalidateKeys: [queryKeys.calendarItem(item.id), queryKeys.recurrenceSeries(organizationId)],
    onSuccess: setCreated,
  });

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    bind.mutate(undefined);
  };

  if (created) {
    return (
      <div className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-md border p-3">
        <p className="text-body-medium text-on-surface">
          {created.scope === 'event_series'
            ? 'Tasks will be added for each event.'
            : 'Work was added for this event.'}
        </p>
        <p className="text-body-small text-on-surface-variant">
          Docket created today&apos;s work and will keep the series in sync with the calendar.
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/orgs/${created.organizationId}/recurrence-series/${created.recurrenceSeriesId}`}
            >
              Manage repeating work
            </Link>
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-md border p-3"
    >
      <p className="text-body-small text-on-surface-variant">
        {item.recurringEventId
          ? 'Choose the reusable work Docket should create for this event and each future occurrence.'
          : 'Choose the reusable work Docket should create around this event.'}
      </p>
      <label className="text-label-medium flex flex-col gap-1">
        <span className="text-on-surface-variant">Workspace</span>
        <Select
          value={organizationId}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setDefinitionId('');
          }}
        >
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-label-medium flex flex-col gap-1">
        <span className="text-on-surface-variant">Reusable work</span>
        <Select
          value={selectedDefinition?.id ?? ''}
          disabled={definitions.isPending || options.length === 0}
          onChange={(event) => {
            setDefinitionId(event.target.value);
          }}
        >
          {options.map((definition: ProcessDefinitionSummaryOut) => (
            <option key={definition.id} value={definition.id}>
              {definition.name}
            </option>
          ))}
        </Select>
      </label>
      {definitions.isError ? (
        <p role="alert" className="text-error text-body-small">
          We couldn&apos;t load reusable work. Please try again.
        </p>
      ) : options.length === 0 && !definitions.isPending ? (
        <p className="text-body-small text-on-surface-variant">
          Repeat a project first to make its work reusable here.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!selectedDefinition || bind.isPending}>
          {bind.isPending
            ? 'Adding…'
            : item.recurringEventId
              ? 'Add tasks for each event'
              : 'Plan work around this event'}
        </Button>
      </div>
      {bind.isError ? (
        <p role="alert" className="text-error text-body-small">
          {item.recurringEventId
            ? 'We couldn’t add tasks for each event. Please try again.'
            : 'We couldn’t plan work around this event. Please try again.'}
        </p>
      ) : null}
    </form>
  );
}
