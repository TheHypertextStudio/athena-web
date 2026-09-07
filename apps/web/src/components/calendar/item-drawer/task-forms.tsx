'use client';

import { OrganizationId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';
import { Button, Input, Select, Surface } from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';

import { useLinkTaskToItem } from '../calendar-mutations';

/** Props shared by task forms attached to a calendar item. */
interface TaskFormProps {
  /** Owning calendar item id. */
  itemId: string;
  /** Close the form after cancellation or success. */
  onDone: () => void;
}

/** Props for {@link LinkTaskForm}. */
export type LinkTaskFormProps = TaskFormProps;

/** A task named by a pasted link, which carries its workspace as well as its id. */
interface PastedTaskLink {
  readonly organizationId: ReturnType<typeof OrganizationId.parse>;
  readonly taskId: ReturnType<typeof TaskId.parse>;
}

/**
 * Read a task out of a link to it.
 *
 * @remarks
 * The realistic way a person names a task is by copying its address, which is
 * `/orgs/<orgId>/tasks/<taskId>` and therefore already carries both ids. Asking them to open the
 * task, find a 26-character identifier, and retype it into a second field alongside a workspace
 * they have to pick correctly is the worst version of this control. A picker would be better
 * still, and needs a `calendar-item.task` relation definition that does not exist yet.
 *
 * @param value - Whatever was typed or pasted.
 * @returns the workspace and task, or `null` when the value is not a task link.
 */
function taskFromLink(value: string): PastedTaskLink | null {
  const match = /\/orgs\/([^/\s?#]+)\/tasks\/([^/\s?#]+)/.exec(value.trim());
  const org = OrganizationId.safeParse(match?.[1]);
  const task = TaskId.safeParse(match?.[2]);
  return org.success && task.success ? { organizationId: org.data, taskId: task.data } : null;
}

/** Attach an existing task to a calendar item, by pasted link or by id. */
export function LinkTaskForm({ itemId, onDone }: LinkTaskFormProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const link = useLinkTaskToItem(itemId);
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? null);
  const [taskIdInput, setTaskIdInput] = useState('');
  const pasted = taskFromLink(taskIdInput);
  const parsedTaskId = TaskId.safeParse(taskIdInput.trim());
  const resolved =
    pasted ??
    (organizationId && parsedTaskId.success ? { organizationId, taskId: parsedTaskId.data } : null);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!resolved) return;
    link.mutate(
      { organizationId: resolved.organizationId, taskId: resolved.taskId, role: 'related' },
      { onSuccess: onDone },
    );
  };

  return (
    <Surface tone="card" shape="medium" pad="comfortable">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="text-label-medium flex flex-col gap-1">
          <span className="text-on-surface-variant">Task link or ID</span>
          <Input
            value={taskIdInput}
            aria-label="Task ID"
            onChange={(event) => {
              setTaskIdInput(event.target.value);
            }}
            placeholder="Paste a task link"
          />
          {taskIdInput.length > 0 && !resolved ? (
            <span className="text-error text-body-small">Paste a link to the task, or its id.</span>
          ) : null}
        </label>
        {/* A pasted link names its own workspace, so the picker is only for a bare id. */}
        {pasted ? null : (
          <OrganizationPicker
            organizationId={organizationId}
            onChange={setOrganizationId}
            organizations={orgs}
          />
        )}
        <TaskFormActions
          onDone={onDone}
          pending={link.isPending}
          disabled={!resolved}
          label="Link task"
          pendingLabel="Linking…"
        />
        {link.isError ? (
          <p role="alert" className="text-error text-body-small">
            We couldn&apos;t link this task. Please try again.
          </p>
        ) : null}
      </form>
    </Surface>
  );
}

interface OrganizationPickerProps {
  organizationId: string | null;
  onChange: (organizationId: ReturnType<typeof OrganizationId.parse>) => void;
  organizations: readonly { id: string; name: string }[];
}

function OrganizationPicker({
  organizationId,
  onChange,
  organizations,
}: OrganizationPickerProps): JSX.Element {
  return (
    <label className="text-label-medium flex flex-col gap-1">
      <span className="text-on-surface-variant">Organization</span>
      <Select
        value={organizationId ?? ''}
        onChange={(event) => {
          onChange(OrganizationId.parse(event.target.value));
        }}
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

interface TaskFormActionsProps {
  onDone: () => void;
  pending: boolean;
  disabled: boolean;
  label: string;
  pendingLabel: string;
}

function TaskFormActions({
  onDone,
  pending,
  disabled,
  label,
  pendingLabel,
}: TaskFormActionsProps): JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? pendingLabel : label}
      </Button>
    </div>
  );
}
