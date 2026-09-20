'use client';

import type { SourcePersonReferenceOut } from '@docket/connections/integration-contract';
import { ActorAvatar } from '@docket/ui/components';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Text,
} from '@docket/ui/primitives';
import { useState, useRef, useEffect, type JSX } from 'react';
import { ActorId } from '@docket/identity-access/ids';
import { useApiQuery, useApiListQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { peopleQuery } from './people-queries';
import { sourcePersonCandidatesQuery, useResolveSourcePerson } from './source-person-queries';

/** Display preserved source attribution and resolve it without leaving the current work. */
export function SourcePersonControl({
  orgId,
  source: sourceRecord,
}: {
  orgId: string;
  source: SourcePersonReferenceOut;
}): JSX.Element {
  const source = {
    ...sourceRecord,
    displayName:
      sourceRecord.displayName.trim() || `${sourceRecord.provider} user ${sourceRecord.externalId}`,
  };
  const [open, setOpen] = useState(false);
  const { canManage } = useCanManageOrg(orgId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="max-w-full min-w-0"
          aria-label={`Identity: ${source.canonicalDisplayName ?? source.displayName}`}
        >
          <ActorAvatar
            kind="human"
            name={source.canonicalDisplayName ?? source.displayName}
            avatarUrl={source.canonicalAvatarUrl ?? source.avatarUrl}
          />
          <span className="truncate">{source.canonicalDisplayName ?? source.displayName}</span>
        </Button>
      </PopoverTrigger>
      {canManage ? (
        open ? (
          <SourcePersonResolution
            key={`${orgId}:${source.externalActorId}`}
            orgId={orgId}
            source={source}
            onDone={() => {
              setOpen(false);
            }}
          />
        ) : null
      ) : (
        <PopoverContent width="xl" align="start">
          <SourcePersonHeading source={source} />
          <Text token="body-small">A workspace manager can link this identity to a person.</Text>
        </PopoverContent>
      )}
    </Popover>
  );
}

type ResolutionAction = 'match_existing' | 'create_actor' | 'unlink';
interface ResolutionProps {
  orgId: string;
  source: SourcePersonReferenceOut;
  onDone: () => void;
}
function useResolutionForm(source: SourcePersonReferenceOut) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [personName, setPersonName] = useState(source.displayName.slice(0, 120));
  const [selected, setSelected] = useState(source.actorId ?? '');
  const [decision, setDecision] = useState<ResolutionAction | null>(null);
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const choose = (next: ResolutionAction): void => {
    setDecision(next);
    setRequestId(crypto.randomUUID());
    setError(null);
  };
  const cancel = (pending: boolean): void => {
    if (pending) return;
    setDecision(null);
    setError(null);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  };
  const rename = (name: string): void => {
    setPersonName(name);
    setRequestId(crypto.randomUUID());
  };
  return {
    searchRef,
    cancel,
    rename,
    search,
    setSearch,
    selected,
    setSelected,
    decision,
    error,
    setError,
    personName,
    choose,
    requestId,
  };
}
function useSourceResolution({ orgId, source, onDone }: ResolutionProps) {
  const candidates = useApiListQuery(sourcePersonCandidatesQuery(orgId, source, true));
  const people = useApiQuery(peopleQuery(orgId));
  const resolve = useResolveSourcePerson(orgId, source);
  const form = useResolutionForm(source);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { decision, personName, requestId, selected, setError } = form;
  const selectedPerson = people.data?.items.find((person) => person.actorId === selected);
  const save = async (): Promise<void> => {
    if (!decision || resolve.isPending) return;
    if (decision === 'create_actor' && (!personName.trim() || personName.trim().length > 120))
      return;
    try {
      await resolve.mutateAsync({
        requestId,
        decision:
          decision === 'match_existing'
            ? { action: decision, actorId: ActorId.parse(selected) }
            : decision === 'create_actor'
              ? { action: decision, name: personName.trim() }
              : { action: decision },
      });
      if (alive.current) onDone();
    } catch (caught) {
      if (alive.current) setError(userErrorMessage(caught, 'Could not link this identity.'));
    }
  };
  return {
    ...form,
    candidates,
    people,
    resolve,
    selectedPerson,
    save,
    cancel: () => {
      form.cancel(resolve.isPending);
    },
  };
}
type ResolutionState = ReturnType<typeof useSourceResolution>;
function SourcePersonResolution(props: ResolutionProps): JSX.Element {
  const state = useSourceResolution(props);
  return (
    <PopoverContent
      width="xl"
      align="start"
      onEscapeKeyDown={(event) => {
        if (!state.decision) return;
        event.preventDefault();
        event.stopPropagation();
        state.cancel();
      }}
    >
      <SourcePersonHeading source={props.source} />
      <div className="flex flex-col gap-3 pt-3">
        {state.decision ? (
          <ResolutionConfirmation source={props.source} state={state} />
        ) : (
          <ResolutionChoices source={props.source} state={state} />
        )}
        {state.error ? (
          <Text role="alert" tone="error" token="body-small">
            {state.error}
          </Text>
        ) : null}
      </div>
    </PopoverContent>
  );
}
function ResolutionConfirmation({
  source,
  state,
}: {
  source: SourcePersonReferenceOut;
  state: ResolutionState;
}): JSX.Element {
  return (
    <>
      <Text token="body-medium">{resolutionMessage(source, state)}</Text>
      {state.decision === 'create_actor' ? (
        <Input
          autoFocus
          aria-label="Person name"
          value={state.personName}
          maxLength={120}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            void state.save();
          }}
          disabled={state.resolve.isPending}
          onChange={(event) => {
            state.rename(event.target.value);
          }}
        />
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          autoFocus={state.decision !== 'create_actor'}
          disabled={
            state.resolve.isPending ||
            (state.decision === 'create_actor' && !state.personName.trim())
          }
          onClick={() => {
            void state.save();
          }}
        >
          {state.resolve.isPending ? 'Saving…' : 'Confirm'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={state.resolve.isPending}
          onClick={() => {
            state.cancel();
          }}
        >
          Back
        </Button>
      </div>
    </>
  );
}
function resolutionMessage(source: SourcePersonReferenceOut, state: ResolutionState): string {
  if (state.decision === 'match_existing')
    return `Link this ${source.provider} identity to ${state.selectedPerson?.displayName ?? 'this person'} for this workspace? Other references to this identity will use that person.`;
  if (state.decision === 'create_actor')
    return `Create a person record in this workspace and link this identity? No invitation will be sent.`;
  return 'Remove this identity link? Source attribution will remain visible.';
}
function ResolutionChoices({
  source,
  state,
}: {
  source: SourcePersonReferenceOut;
  state: ResolutionState;
}): JSX.Element {
  return (
    <>
      <Text token="title-small">Same person?</Text>
      {state.candidates.data?.items.map((candidate) => (
        <Button
          type="button"
          variant="ghost"
          key={candidate.actorId}
          onClick={() => {
            state.setSelected(candidate.actorId);
            state.choose('match_existing');
          }}
        >
          <span aria-hidden="true">
            <ActorAvatar
              kind="human"
              name={candidate.displayName}
              avatarUrl={candidate.avatarUrl}
            />
          </span>
          {candidate.displayName} · {candidateReason(candidate.reason)}
        </Button>
      ))}
      {state.candidates.isError ? (
        <Text role="alert" token="body-small">
          Could not load suggested matches.
        </Text>
      ) : null}
      <Input
        ref={state.searchRef}
        aria-label="Search workspace people"
        placeholder="Search people…"
        value={state.search}
        onChange={(event) => {
          state.setSearch(event.target.value);
        }}
      />
      <ExistingPersonSelect state={state} />
      <Button
        type="button"
        disabled={!state.selected}
        onClick={() => {
          state.choose('match_existing');
        }}
      >
        Link selected person
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          state.choose('create_actor');
        }}
      >
        Add as a new person
      </Button>
      {source.actorId ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            state.choose('unlink');
          }}
        >
          Remove link
        </Button>
      ) : null}
    </>
  );
}
function candidateReason(reason: string): string {
  if (reason === 'email') return 'Matching email';
  return reason === 'linked' ? 'Currently linked' : 'Matching name';
}

function ExistingPersonSelect({ state }: { state: ResolutionState }): JSX.Element {
  return (
    <Select
      aria-label="Existing person"
      value={state.selected}
      onChange={(event) => {
        state.setSelected(event.target.value);
      }}
    >
      <option value="">Choose a person</option>
      {state.people.data?.items
        .filter((person) =>
          person.displayName.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()),
        )
        .map((person) => (
          <option key={person.actorId} value={person.actorId}>
            {person.displayName}
          </option>
        ))}
    </Select>
  );
}

function SourcePersonHeading({ source }: { source: SourcePersonReferenceOut }): JSX.Element {
  return (
    <>
      <Text token="title-small">{source.displayName}</Text>
      <Text token="body-small" tone="muted">
        {source.provider} · {source.externalId}
      </Text>
    </>
  );
}
