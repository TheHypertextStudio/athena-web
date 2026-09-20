'use client';

import {
  ActorAvatar,
  ActorPicker,
  type ActorPickerProps,
  type PickerOption,
} from '@docket/ui/components';
import { useRef, useState, type JSX } from 'react';
import { useOptionalActiveOrg } from '@/components/active-org';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { userErrorMessage } from '@/lib/problem';
import { useAddPerson } from './people-queries';
import { PersonCreateConfirmation } from './person-create-confirmation';

/** A workspace-aware actor picker that creates people without inviting them. */
export function WorkspaceActorPicker(
  props: ActorPickerProps & { orgId?: string | undefined },
): JSX.Element {
  const workspace = useOptionalActiveOrg();
  const orgId = props.orgId ?? workspace?.activeOrgId;
  if (!orgId) return <ActorPicker {...props} />;
  return (
    <WorkspacePersonPicker
      key={orgId}
      {...props}
      orgId={orgId}
      workspaceName={workspace?.orgName(orgId) ?? 'this workspace'}
    />
  );
}

function usePersonPickerCreation(orgId: string, props: ActorPickerProps) {
  const { canContribute } = useCanManageOrg(orgId);
  const addPerson = useAddPerson(orgId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<{ name: string; requestId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PickerOption[]>([]);
  const mounted = useRef(true);
  const submitting = useRef(false);
  // Workspace changes unmount this keyed instance; a completed old request must not select into the new editor.
  const ref = (node: HTMLDivElement | null): void => {
    mounted.current = node !== null;
  };
  const options = [
    ...props.options,
    ...created.filter((item) => !props.options.some((option) => option.value === item.value)),
  ];
  const cancel = (): void => {
    if (!addPerson.isPending) {
      setPending(null);
      setError(null);
    }
  };
  const confirm = (): Promise<void> =>
    createAndSelect({
      pending,
      submitting,
      mounted,
      addPerson,
      setError,
      setCreated,
      onChange: props.onChange,
      close: () => {
        setPending(null);
        setOpen(false);
        props.onOpenChange?.(false);
      },
    });
  return {
    open,
    setOpen,
    query,
    setQuery,
    pending,
    setPending,
    error,
    setError,
    options,
    cancel,
    confirm,
    ref,
    busy: addPerson.isPending,
    canCreate: canContribute && !props.readOnly,
  };
}

function WorkspacePersonPicker({
  orgId,
  workspaceName,
  ...props
}: ActorPickerProps & { orgId: string; workspaceName: string }): JSX.Element {
  const state = usePersonPickerCreation(orgId, props);
  return (
    <div ref={state.ref} className="contents">
      <ActorPicker
        {...props}
        options={state.options}
        open={state.open}
        query={props.query ?? state.query}
        onQueryChange={(next) => {
          state.setQuery(next);
          props.onQueryChange?.(next);
        }}
        onOpenChange={(next) => {
          if (state.busy) return;
          state.setOpen(next);
          if (!next) state.cancel();
          props.onOpenChange?.(next);
        }}
        create={
          state.canCreate
            ? {
                preserveQuery: true,
                canCreate: (name) => name.length > 0 && name.length <= 120,
                render: (name) => personCreateLabel(name, state.options),
                onCreate: (name) => {
                  state.setPending({ name, requestId: crypto.randomUUID() });
                  state.setError(null);
                },
              }
            : null
        }
        confirmation={
          state.pending ? (
            <PersonCreateConfirmation
              name={state.pending.name}
              workspaceName={workspaceName}
              busy={state.busy}
              error={state.error}
              onCancel={state.cancel}
              onConfirm={() => {
                void state.confirm();
              }}
            />
          ) : null
        }
        onCancelConfirmation={state.cancel}
      />
    </div>
  );
}

function personCreateLabel(name: string, options: readonly PickerOption[]): string {
  return options.some((item) => item.label.toLocaleLowerCase() === name.toLocaleLowerCase())
    ? `Add another person named “${name}”`
    : `Add “${name}”`;
}

interface CreateAndSelectOptions {
  pending: { name: string; requestId: string } | null;
  submitting: React.RefObject<boolean>;
  mounted: React.RefObject<boolean>;
  addPerson: ReturnType<typeof useAddPerson>;
  setError: (error: string | null) => void;
  setCreated: React.Dispatch<React.SetStateAction<PickerOption[]>>;
  onChange: (id: string) => void;
  close: () => void;
}

async function createAndSelect({
  pending,
  submitting,
  mounted,
  addPerson,
  setError,
  setCreated,
  onChange,
  close,
}: CreateAndSelectOptions): Promise<void> {
  if (!pending || submitting.current) return;
  submitting.current = true;
  setError(null);
  try {
    const person = await addPerson.mutateAsync({
      displayName: pending.name,
      requestId: pending.requestId,
    });
    if (!mounted.current) return;
    setCreated((items) => [
      ...items,
      {
        value: person.actorId,
        label: person.displayName,
        icon: <ActorAvatar kind="human" name={person.displayName} size={20} />,
      },
    ]);
    onChange(person.actorId);
    close();
  } catch (caught) {
    if (mounted.current) setError(userErrorMessage(caught, 'Could not add this person.'));
  } finally {
    submitting.current = false;
  }
}
