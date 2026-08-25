'use client';

/** Read and safely repair one personal Time Ledger record without turning its list row into a form. */
import { Temporal } from '@js-temporal/polyfill';
import type { TimeRecordOut } from '@docket/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';
import { Trash2 } from '@docket/ui/icons';
import { useEffect, useState, type JSX } from 'react';

import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  type LocalInputOccurrence,
} from '@/components/calendar/datetime-input';
import Link from '@/components/docket-link';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { useApiMutation } from '@/lib/query';

import { formatDuration } from './format-duration';

/** Props for {@link TimeRecordDialog}. */
export interface TimeRecordDialogProps {
  readonly record: TimeRecordOut | null;
  readonly timezone: string;
  readonly categories: readonly { id: string; name: string }[];
  readonly onOpenChange: (open: boolean) => void;
}

function wallTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString()
    .slice(0, 16);
}

/** Show interval evidence and expose only the repair operations the record policy permits. */
export function TimeRecordDialog({
  record,
  timezone,
  categories,
  onOpenChange,
}: TimeRecordDialogProps): JSX.Element {
  const [editingIntervalId, setEditingIntervalId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [startOccurrence, setStartOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [endOccurrence, setEndOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEditingIntervalId(null);
    setTitle(record?.title ?? '');
    setCategoryId(record?.categoryId ?? '');
    setStartOccurrence(null);
    setEndOccurrence(null);
    setConfirmingRemoval(false);
    setError(null);
  }, [record?.id]);
  const updateRecord = useApiMutation({
    mutationFn: async (input: { readonly title: string; readonly categoryId: string | null }) => {
      if (!record) throw new Error('Time record is unavailable.');
      const response = await api.v1.time.records[':id'].$patch({
        param: { id: record.id },
        json: input,
      });
      if (!response.ok) throw new Error('Could not save this time record.');
      return response.json();
    },
    invalidateKeys: [['me', 'time']],
  });
  const repair = useApiMutation({
    mutationFn: async (input: {
      readonly intervalId: string;
      readonly startsAt: string;
      readonly endsAt: string;
    }) => {
      if (!record) throw new Error('Time record is unavailable.');
      const response = await api.v1.time.records[':id'].intervals[':intervalId'].$patch({
        param: { id: record.id, intervalId: input.intervalId },
        json: { startsAt: input.startsAt, endsAt: input.endsAt },
      });
      if (!response.ok) throw new Error('Could not repair this interval.');
      return response.json();
    },
    invalidateKeys: [['me', 'time']],
  });
  const remove = useApiMutation({
    mutationFn: async () => {
      if (!record) throw new Error('Time record is unavailable.');
      const response = await api.v1.time.records[':id'].$delete({ param: { id: record.id } });
      if (!response.ok) throw new Error('Could not remove this time record.');
      return response.json();
    },
    invalidateKeys: [['me', 'time']],
  });
  if (!record) return <Dialog open={false} onOpenChange={onOpenChange} />;
  const repairableRecord =
    record.status === 'closed' &&
    (record.captureSource === 'manual' || record.captureSource === 'reconstructed');
  const repairableIntervals = record.intervals.filter(
    (interval) =>
      interval.supersededById === null &&
      interval.actorKind === 'human' &&
      interval.endedAt !== null &&
      (interval.source === 'manual_entry' || interval.source === 'reconstructed_entry'),
  );

  function beginRepair(interval: (typeof repairableIntervals)[number]): void {
    setEditingIntervalId(interval.id);
    setStartsAt(wallTime(interval.startedAt, timezone));
    setEndsAt(wallTime(interval.endedAt ?? interval.startedAt, timezone));
    setStartOccurrence(localInputOccurrenceForInstant(interval.startedAt, timezone));
    setEndOccurrence(
      interval.endedAt ? localInputOccurrenceForInstant(interval.endedAt, timezone) : null,
    );
    setError(null);
  }
  function saveRepair(): void {
    const startError = localInputResolutionError(startsAt, timezone, startOccurrence, 'start');
    const endError = localInputResolutionError(endsAt, timezone, endOccurrence, 'end');
    const start = fromLocalInputValue(startsAt, timezone, startOccurrence);
    const end = fromLocalInputValue(endsAt, timezone, endOccurrence);
    if (
      !editingIntervalId ||
      startError ||
      endError ||
      !start ||
      !end ||
      Temporal.Instant.compare(Temporal.Instant.from(end), Temporal.Instant.from(start)) <= 0
    ) {
      setError(startError ?? endError ?? 'Choose an end time after the start time.');
      return;
    }
    repair.mutate(
      { intervalId: editingIntervalId, startsAt: start, endsAt: end },
      {
        onSuccess: () => {
          setEditingIntervalId(null);
          setError(null);
        },
        onError: (caught) => {
          setError(userErrorMessage(caught, 'Could not repair this interval.'));
        },
      },
    );
  }
  function saveRecord(): void {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give this session a name.');
      return;
    }
    updateRecord.mutate(
      { title: trimmed, categoryId: categoryId || null },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (caught) => {
          setError(userErrorMessage(caught, 'Could not save this time record.'));
        },
      },
    );
  }
  function removeRecord(): void {
    remove.mutate(undefined, {
      onSuccess: () => {
        onOpenChange(false);
      },
      onError: (caught) => {
        setError(userErrorMessage(caught, 'Could not remove this time record.'));
      },
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{record.title.trim() || 'Unnamed session'}</DialogTitle>
          <DialogDescription>
            {formatDuration(record.measures.humanEffortMs)} human effort.{' '}
            {repairableRecord
              ? 'You can correct manual intervals below.'
              : 'You can update session details, but these recorded intervals are read-only.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
          <div className="bg-surface-container-low grid grid-cols-1 gap-3 rounded-xl p-4 sm:grid-cols-2">
            <Field label="Session name">
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            </Field>
            <Field label="Category">
              <Select
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                }}
              >
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            {record.taskId && record.organizationId ? (
              <Link
                href={`/orgs/${record.organizationId}/tasks/${record.taskId}`}
                className="text-primary text-body-small hover:underline sm:col-span-2"
              >
                Open linked task
              </Link>
            ) : (
              <Text token="body-small" tone="muted" className="sm:col-span-2">
                This session has no linked task.
              </Text>
            )}
          </div>
          {record.intervals
            .filter((interval) => interval.supersededById === null)
            .map((interval) => (
              <div
                key={interval.id}
                className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-xl p-4"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <Text token="body-medium">
                    {interval.actorKind === 'agent' ? 'Agent interval' : 'Human interval'}
                  </Text>
                  <Text token="body-small" tone="muted" numeric>
                    {interval.endedAt
                      ? formatDuration(
                          Date.parse(interval.endedAt) - Date.parse(interval.startedAt),
                        )
                      : 'In progress'}
                  </Text>
                </div>
                {editingIntervalId === interval.id ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CalendarTimeField
                      label="Started"
                      value={startsAt}
                      displayTimezone={timezone}
                      occurrence={startOccurrence}
                      onValueChange={(value) => {
                        setStartsAt(value);
                        setStartOccurrence(null);
                      }}
                      onOccurrenceChange={setStartOccurrence}
                    />
                    <CalendarTimeField
                      label="Ended"
                      value={endsAt}
                      displayTimezone={timezone}
                      occurrence={endOccurrence}
                      onValueChange={(value) => {
                        setEndsAt(value);
                        setEndOccurrence(null);
                      }}
                      onOccurrenceChange={setEndOccurrence}
                    />
                  </div>
                ) : (
                  <Text token="body-small" tone="muted">
                    {new Date(interval.startedAt).toLocaleString(undefined, { timeZone: timezone })}
                    {interval.endedAt
                      ? ` – ${new Date(interval.endedAt).toLocaleTimeString(undefined, { timeZone: timezone })}`
                      : ''}
                  </Text>
                )}
                {repairableIntervals.some((candidate) => candidate.id === interval.id) ? (
                  editingIntervalId === interval.id ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveRepair} disabled={repair.isPending}>
                        {repair.isPending ? 'Saving…' : 'Save correction'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingIntervalId(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        beginRepair(interval);
                      }}
                    >
                      Correct times
                    </Button>
                  )
                ) : null}
              </div>
            ))}
          {error ? (
            <Text role="alert" token="body-small" className="text-error">
              {error}
            </Text>
          ) : null}
          {confirmingRemoval ? (
            <div className="border-error/30 bg-error-container/30 flex flex-col gap-3 rounded-xl border p-4">
              <Text token="body-medium">Remove this time from your personal history?</Text>
              <Text token="body-small" tone="muted">
                Athena keeps the audit record, but this entry will no longer appear in your ledger.
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setConfirmingRemoval(false);
                  }}
                >
                  Keep time
                </Button>
                <Button className="text-error" onClick={removeRecord} disabled={remove.isPending}>
                  {remove.isPending ? 'Removing…' : 'Remove time'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={saveRecord} disabled={updateRecord.isPending}>
            {updateRecord.isPending ? 'Saving…' : 'Save details'}
          </Button>
          {repairableRecord ? (
            <Button
              variant="ghost"
              className="text-error"
              onClick={() => {
                setConfirmingRemoval(true);
              }}
              disabled={remove.isPending}
            >
              <Trash2 aria-hidden="true" /> Remove time
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
