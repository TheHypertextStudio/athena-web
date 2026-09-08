'use client';

/** Personal settings for the canonical repeating work schedule and dated replacements. */
import {
  WorkScheduleConflictPayload,
  WorkScheduleLegacyConflictPayload,
  type WorkPlaceOut,
  type WorkScheduleChangeOut,
  type WorkScheduleExceptionCreate,
  type WorkScheduleOut,
  type WorkSchedulePlanCreate,
  type WorkSchedulePlanOut,
} from '@docket/planning/work-location-contract';
import { selectCurrentOrNextWorkSchedulePlan } from '@docket/planning/work-schedule';
import { Calendar, ChevronDown, Plus } from '@docket/ui/icons';
import { EmptyState } from '@docket/ui/components';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DecorativeIcon,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingRow } from '@/components/settings/setting-row';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import {
  workLocationPlacesDef,
  workScheduleChangesDef,
  workScheduleDef,
} from '@/components/work-location/work-location-data';
import {
  WorkScheduleDateDialog,
  WorkScheduleEditorDialog,
  workScheduleDayLabel,
  workScheduleSegmentSummary,
} from '@/components/work-location/work-schedule-editor-dialog';
import { api } from '@/lib/api';
import { toUserFacingError, UserFacingError, userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiListQuery, useApiMutation, useApiQuery } from '@/lib/query';

function firstPresent(values: readonly unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined);
}

function itemsOrEmpty<T>(items: readonly T[] | undefined): readonly T[] {
  return items ?? [];
}

async function noContent(
  call: () => Promise<{ readonly ok: boolean; readonly status: number }>,
): Promise<void> {
  try {
    const response = await call();
    if (!response.ok) {
      throw new UserFacingError('Could not resolve that schedule change.', {
        status: response.status,
      });
    }
  } catch (error) {
    throw toUserFacingError(error, 'Could not resolve that schedule change.');
  }
}

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function currentDateIn(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function scheduleDayDescription(
  day: WorkSchedulePlanOut['cycleDays'][number],
  places: readonly WorkPlaceOut[],
): string {
  if (day.segments.length === 0) return 'Not working';
  return day.segments.map((segment) => workScheduleSegmentSummary(segment, places)).join(' · ');
}

function groupedScheduleDays(plan: WorkSchedulePlanOut): readonly {
  readonly key: string;
  readonly label: string;
  readonly day: WorkSchedulePlanOut['cycleDays'][number];
}[] {
  const groups = new Map<
    string,
    { readonly day: WorkSchedulePlanOut['cycleDays'][number]; readonly indexes: number[] }
  >();
  plan.cycleDays.forEach((day, index) => {
    const key = JSON.stringify(day.segments);
    const group = groups.get(key);
    if (group) group.indexes.push(index);
    else groups.set(key, { day, indexes: [index] });
  });
  return [...groups.entries()].map(([key, group]) => {
    const labels = group.indexes.map((index) =>
      workScheduleDayLabel(plan.anchorDate, plan.cycleDays.length, index),
    );
    const consecutive = group.indexes.every(
      (index, position) => position === 0 || index === (group.indexes[position - 1] ?? index) + 1,
    );
    const label =
      consecutive && labels.length > 1
        ? `${labels[0] ?? ''}–${labels.at(-1) ?? ''}`
        : new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(labels);
    return { key, label, day: group.day };
  });
}

function DefaultScheduleGroup(props: {
  readonly plan: WorkSchedulePlanOut | null;
  readonly places: readonly WorkPlaceOut[];
  readonly onEdit: () => void;
}): JSX.Element {
  if (!props.plan) {
    return (
      <SettingsGroup capability={SETTINGS_NODES.workScheduleDefault} body="rows">
        <EmptyState
          icon={Calendar}
          title="No default schedule"
          body="Set when and where you normally work. You can use a weekly schedule or a longer rotation."
          frame="none"
          cta={{ label: 'Create default schedule', onClick: props.onEdit }}
        />
      </SettingsGroup>
    );
  }
  const plan = props.plan;
  return (
    <SettingsGroup capability={SETTINGS_NODES.workScheduleDefault} body="rows">
      {groupedScheduleDays(plan).map(({ key, label, day }) => {
        return (
          <SettingRow
            key={key}
            leading={<DecorativeIcon icon={Calendar} />}
            label={label}
            description={scheduleDayDescription(day, props.places)}
          />
        );
      })}
    </SettingsGroup>
  );
}

function DateChangesGroup(props: {
  readonly schedule: WorkScheduleOut;
  readonly places: readonly WorkPlaceOut[];
  readonly timezone: string;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
}): JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false);
  const currentDate = currentDateIn(props.timezone);
  const upcoming = props.schedule.exceptions.filter((exception) => exception.date >= currentDate);
  const past = props.schedule.exceptions
    .filter((exception) => exception.date < currentDate)
    .reverse();
  const action = props.canEdit ? (
    <Button variant="outline" size="sm" onClick={props.onEdit}>
      <Plus aria-hidden="true" />
      Add date change
    </Button>
  ) : undefined;
  return (
    <SettingsGroup capability={SETTINGS_NODES.workScheduleDateChanges} body="rows" action={action}>
      {upcoming.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No upcoming date changes"
          body="Future changes for time off, travel, or a different workplace appear here."
          frame="none"
        />
      ) : (
        upcoming.map((exception) => (
          <SettingRow
            key={exception.id}
            leading={<DecorativeIcon icon={Calendar} />}
            label={formattedDate(exception.date)}
            description={
              exception.segments.length === 0
                ? 'Not working'
                : exception.segments
                    .map((segment) => workScheduleSegmentSummary(segment, props.places))
                    .join(' · ')
            }
          />
        ))
      )}
      {past.length > 0 ? (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group h-auto w-full justify-between rounded-none px-4 py-3"
            >
              <span>Past date changes, {String(past.length)}</span>
              <ChevronDown
                aria-hidden="true"
                className="transition-transform group-data-[state=open]:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-outline-variant border-t">
            {past.map((exception) => (
              <SettingRow
                key={exception.id}
                leading={<DecorativeIcon icon={Calendar} />}
                label={formattedDate(exception.date)}
                description={
                  exception.segments.length === 0
                    ? 'Not working'
                    : exception.segments
                        .map((segment) => workScheduleSegmentSummary(segment, props.places))
                        .join(' · ')
                }
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </SettingsGroup>
  );
}

type IncomingScheduleChange =
  | {
      readonly kind: 'schedule_conflict';
      readonly change: WorkScheduleChangeOut;
      readonly payload: WorkScheduleConflictPayload;
    }
  | {
      readonly kind: 'legacy_conflict';
      readonly change: WorkScheduleChangeOut;
      readonly payload: WorkScheduleLegacyConflictPayload;
    };

function incomingScheduleChanges(
  changes: readonly WorkScheduleChangeOut[],
): readonly IncomingScheduleChange[] {
  const incoming: IncomingScheduleChange[] = [];
  for (const change of changes) {
    const schedule = WorkScheduleConflictPayload.safeParse(change.payload);
    if (schedule.success) {
      incoming.push({ kind: 'schedule_conflict', change, payload: schedule.data });
      continue;
    }
    const legacy = WorkScheduleLegacyConflictPayload.safeParse(change.payload);
    if (legacy.success) {
      incoming.push({ kind: 'legacy_conflict', change, payload: legacy.data });
    }
  }
  return incoming;
}

function incomingChangeCopy(item: IncomingScheduleChange): {
  readonly label: string;
  readonly description: string;
} {
  if (item.kind === 'legacy_conflict') {
    return {
      label: 'Existing schedule entries',
      description: 'Some entries overlap or use incompatible schedule rules.',
    };
  }
  return {
    label: formattedDate(item.payload.date),
    description: item.change.accountLabel
      ? `${item.change.accountLabel} changed this date after a Docket edit.`
      : 'A connected account changed this date after a Docket edit.',
  };
}

function IncomingChangesGroup(props: {
  readonly changes: readonly WorkScheduleChangeOut[];
  readonly onResolve: (change: WorkScheduleChangeOut) => void;
}): JSX.Element | null {
  const conflicts = incomingScheduleChanges(props.changes);
  if (conflicts.length === 0) return null;
  return (
    <SettingsGroup capability={SETTINGS_NODES.workScheduleIncomingChanges} body="rows">
      {conflicts.map((item) => {
        const copy = incomingChangeCopy(item);
        return (
          <SettingRow
            key={item.change.id}
            leading={<DecorativeIcon icon={Calendar} />}
            label={copy.label}
            description={copy.description}
            trailing={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  props.onResolve(item.change);
                }}
              >
                Resolve
              </Button>
            }
          />
        );
      })}
    </SettingsGroup>
  );
}

function ScheduleChangeDialog(props: {
  readonly change: WorkScheduleChangeOut | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onKeepDocket: () => void;
  readonly onUseProvider: () => void;
  readonly onKeepExisting: () => void;
  readonly onDefineDefault: () => void;
}): JSX.Element {
  const schedulePayload = WorkScheduleConflictPayload.safeParse(props.change?.payload);
  const legacyPayload = WorkScheduleLegacyConflictPayload.safeParse(props.change?.payload);
  const title = schedulePayload.success
    ? `Resolve ${formattedDate(schedulePayload.data.date)}`
    : 'Resolve existing schedule entries';
  const account = props.change?.accountLabel ?? 'the connected account';
  const legacy = legacyPayload.success;
  return (
    <Dialog open={props.change !== null} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {legacy
              ? 'Docket cannot combine these entries without guessing which place or time should win.'
              : `Docket and ${account} changed this date. Choose which schedule should apply.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-on-surface-variant text-body-medium">
            {legacy
              ? 'You can keep the entries unchanged, or replace them by defining one default schedule.'
              : 'Keeping Docket sends your current date schedule back to the connected account. Using the connected-account change replaces this date in Docket.'}
          </p>
          {props.error ? (
            <p role="alert" className="text-error text-body-small">
              {props.error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={props.pending}>
              Cancel
            </Button>
          </DialogClose>
          {legacy ? (
            <>
              <Button variant="outline" disabled={props.pending} onClick={props.onKeepExisting}>
                Keep existing entries
              </Button>
              <Button disabled={props.pending} onClick={props.onDefineDefault}>
                Define default schedule
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={props.pending} onClick={props.onKeepDocket}>
                Keep Docket schedule
              </Button>
              <Button disabled={props.pending} onClick={props.onUseProvider}>
                Use connected-account change
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleGroups(props: {
  readonly schedule: WorkScheduleOut;
  readonly plan: WorkSchedulePlanOut | null;
  readonly places: readonly WorkPlaceOut[];
  readonly changes: readonly WorkScheduleChangeOut[];
  readonly onEditPlan: () => void;
  readonly onEditDate: () => void;
  readonly onResolve: (change: WorkScheduleChangeOut) => void;
}): JSX.Element {
  return (
    <>
      <DefaultScheduleGroup plan={props.plan} places={props.places} onEdit={props.onEditPlan} />
      <DateChangesGroup
        schedule={props.schedule}
        places={props.places}
        timezone={props.plan?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
        canEdit={props.plan !== null}
        onEdit={props.onEditDate}
      />
      <IncomingChangesGroup changes={props.changes} onResolve={props.onResolve} />
    </>
  );
}

function ScheduleHeaderAction(props: {
  readonly plan: WorkSchedulePlanOut | null;
  readonly onEdit: () => void;
}): JSX.Element | null {
  if (!props.plan) return null;
  return <Button onClick={props.onEdit}>Edit default schedule</Button>;
}

function WorkScheduleContent(props: {
  readonly loadError: unknown;
  readonly schedule: WorkScheduleOut | undefined;
  readonly plan: WorkSchedulePlanOut | null;
  readonly places: readonly WorkPlaceOut[];
  readonly changes: readonly WorkScheduleChangeOut[];
  readonly onEditPlan: () => void;
  readonly onEditDate: () => void;
  readonly onResolve: (change: WorkScheduleChangeOut) => void;
  readonly onRetry: () => void;
}): JSX.Element {
  if (props.loadError || !props.schedule) {
    return (
      <div className="flex flex-col items-start gap-3">
        <LoadFailure
          message={userErrorMessage(props.loadError, 'Could not load your work schedule.')}
        />
        <Button variant="outline" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <ScheduleGroups
      schedule={props.schedule}
      plan={props.plan}
      places={props.places}
      changes={props.changes}
      onEditPlan={props.onEditPlan}
      onEditDate={props.onEditDate}
      onResolve={props.onResolve}
    />
  );
}

function scheduleTimezone(plan: WorkSchedulePlanOut | null): string {
  return plan?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The user-owned Work schedule settings destination. */
export default function WorkScheduleSettingsPage(): JSX.Element {
  const placesQ = useApiListQuery(workLocationPlacesDef());
  const changesQ = useApiListQuery(workScheduleChangesDef());
  const scheduleQ = useApiQuery(workScheduleDef());
  const [editorOpen, setEditorOpen] = useState(false);
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [resolvingChange, setResolvingChange] = useState<WorkScheduleChangeOut | null>(null);
  const invalidateKeys = [queryKeys.workLocation()];

  const savePlan = useApiMutation({
    mutationFn: (value: WorkSchedulePlanCreate) =>
      unwrap(
        () => api.v1.me['work-location'].schedule.$put({ json: value }),
        'Could not save your default work schedule.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setEditorOpen(false);
    },
  });
  const saveDate = useApiMutation({
    mutationFn: (value: WorkScheduleExceptionCreate) =>
      unwrap(
        () =>
          api.v1.me['work-location'].schedule.dates[':date'].$put({
            param: { date: value.date },
            json: value,
          }),
        'Could not save that date change.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setDateEditorOpen(false);
    },
  });
  const resolveChange = useApiMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: WorkScheduleChangeOut['id'];
      action: 'ignore' | 'keep_docket' | 'use_provider';
    }) =>
      noContent(() =>
        api.v1.me['work-location'].changes[':id'].$patch({
          param: { id },
          json: { action },
        }),
      ),
    invalidateKeys,
    onSuccess: () => {
      setResolvingChange(null);
    },
  });

  const plans = itemsOrEmpty(scheduleQ.data?.plans);
  const currentPlan = useMemo(
    () => selectCurrentOrNextWorkSchedulePlan(plans, new Date()),
    [plans],
  );
  const places = itemsOrEmpty(placesQ.data?.items);
  const changes = itemsOrEmpty(changesQ.data?.items);
  const loading = [placesQ.isPending, changesQ.isPending, scheduleQ.isPending].some(Boolean);
  const loadError = firstPresent([placesQ.error, changesQ.error, scheduleQ.error]);

  return (
    <SettingsSectionPage
      sectionKey="work-schedule"
      loading={loading}
      action={
        loadError ? null : (
          <ScheduleHeaderAction
            plan={currentPlan}
            onEdit={() => {
              setEditorOpen(true);
            }}
          />
        )
      }
    >
      <WorkScheduleContent
        loadError={loadError}
        schedule={scheduleQ.data}
        plan={currentPlan}
        places={places}
        changes={changes}
        onEditPlan={() => {
          setEditorOpen(true);
        }}
        onEditDate={() => {
          setDateEditorOpen(true);
        }}
        onResolve={setResolvingChange}
        onRetry={() => {
          void Promise.all([placesQ.refetch(), changesQ.refetch(), scheduleQ.refetch()]);
        }}
      />

      <WorkScheduleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        plan={currentPlan}
        places={places}
        fallbackTimezone={scheduleTimezone(currentPlan)}
        pending={savePlan.isPending}
        error={
          savePlan.error
            ? userErrorMessage(savePlan.error, 'Could not save your default work schedule.')
            : null
        }
        onSave={(value) => {
          savePlan.mutate(value);
        }}
      />
      <WorkScheduleDateDialog
        open={dateEditorOpen}
        onOpenChange={setDateEditorOpen}
        places={places}
        minimumDate={
          currentPlan
            ? ([currentPlan.effectiveFrom, currentDateIn(currentPlan.timezone)].sort().at(-1) ??
              currentPlan.effectiveFrom)
            : currentDateIn(Intl.DateTimeFormat().resolvedOptions().timeZone)
        }
        pending={saveDate.isPending}
        error={
          saveDate.error
            ? userErrorMessage(saveDate.error, 'Could not save that date change.')
            : null
        }
        onSave={(value) => {
          saveDate.mutate(value);
        }}
      />
      <ScheduleChangeDialog
        change={resolvingChange}
        pending={resolveChange.isPending}
        error={
          resolveChange.error
            ? userErrorMessage(resolveChange.error, 'Could not resolve that schedule change.')
            : null
        }
        onOpenChange={(open) => {
          if (!open) setResolvingChange(null);
        }}
        onKeepDocket={() => {
          if (!resolvingChange) return;
          resolveChange.mutate({ id: resolvingChange.id, action: 'keep_docket' });
        }}
        onUseProvider={() => {
          if (!resolvingChange) return;
          resolveChange.mutate({ id: resolvingChange.id, action: 'use_provider' });
        }}
        onKeepExisting={() => {
          if (!resolvingChange) return;
          resolveChange.mutate({ id: resolvingChange.id, action: 'ignore' });
        }}
        onDefineDefault={() => {
          setResolvingChange(null);
          setEditorOpen(true);
        }}
      />
    </SettingsSectionPage>
  );
}
