'use client';

/** Controlled creation of one exact, personal historical time record. */
import { Temporal } from '@js-temporal/polyfill';
import type { OrgSummary } from '@docket/types';
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
import { useEffect, useMemo, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiListQuery, useApiMutation } from '@/lib/query';

/** Props for {@link TimeAddPastDialog}. */
export interface TimeAddPastDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly timezone: string;
  readonly workspaceId?: string | undefined;
  readonly workspaces: readonly OrgSummary[];
}

function nowWallTime(timezone: string): string {
  const date = Temporal.Now.zonedDateTimeISO(timezone).toPlainDateTime();
  return date.toString().slice(0, 16);
}

function toInstant(value: string, timezone: string): string | null {
  try {
    return Temporal.PlainDateTime.from(value).toZonedDateTime(timezone).toInstant().toString();
  } catch {
    return null;
  }
}

/** Create past time with explicit wall-clock bounds in the Hub timezone. */
export function TimeAddPastDialog({
  open,
  onOpenChange,
  timezone,
  workspaceId,
  workspaces,
}: TimeAddPastDialogProps): JSX.Element {
  const [workspace, setWorkspace] = useState(workspaceId ?? workspaces[0]?.id ?? '');
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const now = nowWallTime(timezone);
    setWorkspace(workspaceId ?? workspaces[0]?.id ?? '');
    setTaskId('');
    setTitle('');
    setStartsAt(now);
    setEndsAt(now);
    setError(null);
  }, [open, timezone, workspaceId, workspaces]);
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(workspace),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId: workspace }, query: {} }),
      'Could not load tasks for this workspace.',
      { enabled: Boolean(workspace) },
    ),
  );
  const create = useApiMutation({
    mutationFn: async (input: { readonly startsAt: string; readonly endsAt: string }) => {
      const response = await api.v1.time.records.$post({
        json: {
          startNow: false,
          captureSource: 'manual',
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          context: taskId ? { taskId: taskId } : { label: title.trim(), organizationId: workspace },
        },
      });
      if (!response.ok) throw new Error('Could not save past time.');
      return response.json();
    },
    invalidateKeys: [['me', 'time']],
  });
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const canSave = Boolean(
    workspace && (taskId || title.trim()) && startsAt && endsAt && !create.isPending,
  );

  function save(): void {
    setError(null);
    const start = toInstant(startsAt, timezone);
    const end = toInstant(endsAt, timezone);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      setError('Choose an end time after the start time.');
      return;
    }
    create.mutate(
      { startsAt: start, endsAt: end },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (caught) => {
          setError(userErrorMessage(caught, 'Could not save past time.'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add past time</DialogTitle>
          <DialogDescription>
            Record time you already worked. Athena stores the exact times in {timezone}; it does not
            infer work from your calendar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
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
              disabled={!workspace || tasksQ.isPending}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Started">
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
              />
            </Field>
            <Field label="Ended">
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
              />
            </Field>
          </div>
          {error ? (
            <Text role="alert" token="body-small" className="text-error">
              {error}
            </Text>
          ) : null}
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
