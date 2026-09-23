'use client';

/** Controlled creation of one exact, personal historical time record. */
import { Temporal } from '@js-temporal/polyfill';
import type { OrgSummary } from '../../lib/contracts/organization';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  Select,
} from '@docket/ui/primitives';
import { useEffect, useMemo, useState, type JSX } from 'react';

import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  localInputResolutionError,
  type LocalInputOccurrence,
} from '@/components/calendar/datetime-input';
import { api } from '@/lib/api';
import { fetchAllTasks } from '@/lib/org-collection-pages';
import { apiQueryOptions, queryKeys, unwrap, useApiListQuery, useApiMutation } from '@/lib/query';

/** Props for {@link TimeAddPastDialog}. */
export interface TimeAddPastDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly timezone: string;
  readonly workspaceId?: string | undefined;
  readonly workspaces: readonly OrgSummary[];
  readonly initialTaskId?: string | undefined;
  readonly initialStartsAt?: string | undefined;
  readonly initialEndsAt?: string | undefined;
  readonly onSaved?: () => void;
}

function nowWallTime(timezone: string): string {
  const date = Temporal.Now.zonedDateTimeISO(timezone).toPlainDateTime();
  return date.toString().slice(0, 16);
}

interface TimeWorkFieldsProps {
  readonly workspace: string;
  readonly setWorkspace: (value: string) => void;
  readonly workspaces: TimeAddPastDialogProps['workspaces'];
  readonly taskId: string;
  readonly setTaskId: (value: string) => void;
  readonly tasks: readonly { id: string; title: string }[];
  readonly tasksPending: boolean;
  readonly title: string;
  readonly setTitle: (value: string) => void;
}

function TimeWorkFields(props: TimeWorkFieldsProps): JSX.Element {
  const {
    workspace,
    setWorkspace,
    workspaces,
    taskId,
    setTaskId,
    tasks,
    tasksPending,
    title,
    setTitle,
  } = props;
  return (
    <>
      <Field label="Workspace">
        <Select
          value={workspace}
          onChange={(event) => {
            setWorkspace(event.target.value);
            setTaskId('');
          }}
        >
          <option value="">Choose a workspace</option>
          {workspaces.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Task">
        <Select
          value={taskId}
          onChange={(event) => {
            setTaskId(event.target.value);
          }}
          disabled={!workspace || tasksPending}
        >
          <option value="">Create a task from a title instead</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </Select>
      </Field>
      {!taskId ? (
        <Field label="What did you work on?">
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="Write release notes"
          />
        </Field>
      ) : null}
    </>
  );
}

/** Create past time with explicit wall-clock bounds in the Hub timezone. */
export function TimeAddPastDialog(props: TimeAddPastDialogProps): JSX.Element {
  const {
    open,
    onOpenChange,
    timezone,
    workspaceId,
    workspaces,
    initialTaskId,
    initialStartsAt,
    initialEndsAt,
    onSaved,
  } = props;
  const [workspace, setWorkspace] = useState(workspaceId ?? workspaces[0]?.id ?? '');
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [startOccurrence, setStartOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [endOccurrence, setEndOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const now = nowWallTime(timezone);
    setWorkspace(workspaceId ?? workspaces[0]?.id ?? '');
    setTaskId(initialTaskId ?? '');
    setTitle('');
    setStartsAt(
      initialStartsAt
        ? Temporal.Instant.from(initialStartsAt)
            .toZonedDateTimeISO(timezone)
            .toPlainDateTime()
            .toString()
            .slice(0, 16)
        : now,
    );
    setEndsAt(
      initialEndsAt
        ? Temporal.Instant.from(initialEndsAt)
            .toZonedDateTimeISO(timezone)
            .toPlainDateTime()
            .toString()
            .slice(0, 16)
        : now,
    );
    setStartOccurrence(null);
    setEndOccurrence(null);
    setError(null);
  }, [open, timezone, workspaceId, workspaces, initialTaskId, initialStartsAt, initialEndsAt]);
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(workspace),
      () => fetchAllTasks(api, workspace),
      'Could not load tasks for this workspace.',
      { enabled: Boolean(workspace) },
    ),
  );
  const create = useApiMutation({
    mutationFn: (input: { readonly startsAt: string; readonly endsAt: string }) =>
      unwrap(
        () =>
          api.v1.time.records.$post({
            json: {
              startNow: false,
              captureSource: 'manual',
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              context: taskId
                ? { taskId: taskId }
                : { label: title.trim(), organizationId: workspace },
            },
          }),
        'Could not save past time.',
      ),
    invalidateKeys: [['me', 'time']],
  });
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const canSave = Boolean(
    workspace && (taskId || title.trim()) && startsAt && endsAt && !create.isPending,
  );

  function save(): void {
    setError(null);
    const startError = localInputResolutionError(startsAt, timezone, startOccurrence, 'start');
    const endError = localInputResolutionError(endsAt, timezone, endOccurrence, 'end');
    if (startError || endError) {
      setError(startError ?? endError);
      return;
    }
    const start = fromLocalInputValue(startsAt, timezone, startOccurrence);
    const end = fromLocalInputValue(endsAt, timezone, endOccurrence);
    if (
      !start ||
      !end ||
      Temporal.Instant.compare(Temporal.Instant.from(end), Temporal.Instant.from(start)) <= 0
    ) {
      setError('Choose an end time after the start time.');
      return;
    }
    create.mutate(
      { startsAt: start, endsAt: end },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSaved?.();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent presentation={{ kind: 'centered', size: 'standard' }}>
        <DialogHeader>
          <DialogTitle>Add past time</DialogTitle>
          <DialogDescription>
            Record time you already worked. The exact times will appear in your work history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <TimeWorkFields
            workspace={workspace}
            setWorkspace={setWorkspace}
            workspaces={workspaces}
            taskId={taskId}
            setTaskId={setTaskId}
            tasks={tasks}
            tasksPending={tasksQ.isPending}
            title={title}
            setTitle={setTitle}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {create.isPending ? 'Saving…' : 'Save past time'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
