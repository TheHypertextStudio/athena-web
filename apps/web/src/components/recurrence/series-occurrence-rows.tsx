'use client';

import type { OccurrenceResolution, RecurrenceSeriesDetailOut } from '@/lib/contracts/recurrence';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Surface } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useState } from 'react';
import { DatePicker } from '@/components/date-picker';
import { formatDate, occurrenceLabel } from './series-management-values';

/** Props for one occurrence list. */
interface OccurrenceRowsProps {
  readonly orgId: string;
  readonly items: RecurrenceSeriesDetailOut['occurrences'];
  readonly onResolve?:
    ((scheduledFor: string, resolution: OccurrenceResolution) => void) | undefined;
}

/** Calm rows linking generated ordinary work back into the rest of Docket. */
export function OccurrenceRows({ orgId, items, onResolve }: OccurrenceRowsProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-1 overflow-hidden rounded-xl">
      {items.map((item) => (
        <OccurrenceRow key={item.id} orgId={orgId} item={item} onResolve={onResolve} />
      ))}
    </ul>
  );
}

interface OccurrenceRowProps {
  readonly orgId: string;
  readonly item: RecurrenceSeriesDetailOut['occurrences'][number];
  readonly onResolve?:
    ((scheduledFor: string, resolution: OccurrenceResolution) => void) | undefined;
}

function OccurrenceRow({ orgId, item, onResolve }: OccurrenceRowProps): JSX.Element {
  const editable =
    onResolve !== undefined &&
    ['expected', 'materialized', 'needs_resolution'].includes(item.status);
  return (
    <Surface
      as="li"
      tone="card"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
    >
      <div>
        <p className="text-body-medium text-on-surface">{formatDate(item.scheduledFor)}</p>
        <p className="text-body-small text-on-surface-variant capitalize">
          {occurrenceLabel(item.status)}
          {item.originalScheduledFor
            ? ` · moved from ${formatDate(item.originalScheduledFor)}`
            : ''}
        </p>
      </div>
      {editable ? (
        <OccurrenceActions orgId={orgId} item={item} onResolve={onResolve} />
      ) : (
        <OpenOccurrence orgId={orgId} item={item} />
      )}
    </Surface>
  );
}

function OpenOccurrence({ orgId, item }: OccurrenceRowProps): JSX.Element | null {
  const project = useVocabulary('project').toLocaleLowerCase();
  const task = useVocabulary('task').toLocaleLowerCase();
  const id = item.projectId ?? item.taskId;
  const collection = item.projectId ? 'projects' : 'tasks';
  return id ? (
    <Button asChild variant="ghost" size="sm" className="min-h-10">
      <Link href={`/orgs/${orgId}/${collection}/${id}`}>
        Open {item.projectId ? project : task}
      </Link>
    </Button>
  ) : null;
}

function OccurrenceActions({ orgId, item, onResolve }: OccurrenceRowProps): JSX.Element {
  const [changing, setChanging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [replacementDate, setReplacementDate] = useState(item.scheduledFor);
  const resolve = (resolution: OccurrenceResolution): void => {
    onResolve?.(item.scheduledFor, resolution);
    setMoving(false);
    setChanging(false);
  };
  if (moving)
    return (
      <MoveOccurrence
        scheduledFor={item.scheduledFor}
        replacementDate={replacementDate}
        onDateChange={setReplacementDate}
        onCancel={() => {
          setMoving(false);
        }}
        onResolve={resolve}
      />
    );
  const missed = item.status === 'needs_resolution';
  if (missed || changing)
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10">
        {!missed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChanging(false);
            }}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            resolve({ kind: 'skip' });
          }}
        >
          {missed ? 'Skip' : 'Skip this occurrence'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setMoving(true);
          }}
        >
          {missed ? 'Move' : 'Move this occurrence'}
        </Button>
        {missed ? (
          <Button
            size="sm"
            onClick={() => {
              resolve({ kind: 'complete' });
            }}
          >
            Mark complete
          </Button>
        ) : null}
      </div>
    );
  return (
    <OccurrenceReadyActions
      orgId={orgId}
      item={item}
      onChange={() => {
        setChanging(true);
      }}
    />
  );
}

/** Resting occurrence controls, before a person chooses a resolution. */
function OccurrenceReadyActions({
  orgId,
  item,
  onChange,
}: Pick<OccurrenceRowProps, 'orgId' | 'item'> & { readonly onChange: () => void }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10">
      <OpenOccurrence orgId={orgId} item={item} />
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Change ${formatDate(item.scheduledFor)}`}
        onClick={onChange}
      >
        Change
      </Button>
    </div>
  );
}

function MoveOccurrence({
  scheduledFor,
  replacementDate,
  onDateChange,
  onCancel,
  onResolve,
}: {
  readonly scheduledFor: string;
  readonly replacementDate: string;
  readonly onDateChange: (date: string) => void;
  readonly onCancel: () => void;
  readonly onResolve: (resolution: OccurrenceResolution) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10 [&_input]:min-h-10">
      <DatePicker
        value={replacementDate}
        onChange={(next) => {
          if (next) onDateChange(next);
        }}
        placeholder="Choose a new date"
        ariaLabel={`New date for ${scheduledFor}`}
        triggerVariant="secondary"
        triggerClassName="min-h-10 w-40"
      />
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => {
          onResolve({ kind: 'reschedule', scheduledFor: replacementDate });
        }}
      >
        Save date
      </Button>
    </div>
  );
}
