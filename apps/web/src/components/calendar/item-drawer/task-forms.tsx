'use client';

import { OrganizationId, TaskId } from '@docket/types';
import { Button, Input, Select } from '@docket/ui/primitives';
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

/** Attach an existing task to a calendar item by organization and task id. */
export function LinkTaskForm({ itemId, onDone }: LinkTaskFormProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const link = useLinkTaskToItem(itemId);
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? null);
  const [taskIdInput, setTaskIdInput] = useState('');
  const parsedTaskId = TaskId.safeParse(taskIdInput.trim());

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!organizationId || !parsedTaskId.success) return;
    link.mutate(
      { organizationId, taskId: parsedTaskId.data, role: 'related' },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="border-outline-variant flex flex-col gap-2 rounded-md border p-3"
    >
      <OrganizationPicker
        organizationId={organizationId}
        onChange={setOrganizationId}
        organizations={orgs}
      />
      <label className="text-label-medium flex flex-col gap-1">
        <span className="text-on-surface-variant">Task ID</span>
        <Input
          value={taskIdInput}
          onChange={(event) => {
            setTaskIdInput(event.target.value);
          }}
          placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
        />
        {taskIdInput.length > 0 && !parsedTaskId.success ? (
          <span className="text-error text-body-small">Enter a valid task id.</span>
        ) : null}
      </label>
      <TaskFormActions
        onDone={onDone}
        pending={link.isPending}
        disabled={!organizationId || !parsedTaskId.success}
        label="Link task"
        pendingLabel="Linking…"
      />
      {link.isError ? (
        <p role="alert" className="text-error text-body-small">
          We couldn&apos;t link this task. Please try again.
        </p>
      ) : null}
    </form>
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
