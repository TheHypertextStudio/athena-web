'use client';

import { useState, type JSX } from 'react';
import { ActorId } from '@docket/identity-access/ids';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Text,
} from '@docket/ui/primitives';
import { api } from '@/lib/api';
import { useApiListQuery, useApiMutation, unwrap } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useAppRouter } from '@/lib/interactions/navigation';
import { peopleQuery } from './people-queries';

/** Review and confirm a duplicate record consolidation without losing historical references. */
export function PersonConsolidationControl({
  orgId,
  actorId,
}: {
  orgId: string;
  actorId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost">
          Combine duplicate person
        </Button>
      </PopoverTrigger>
      <PopoverContent width="xl" align="start">
        <ConsolidationReview orgId={orgId} actorId={actorId} />
      </PopoverContent>
    </Popover>
  );
}

function useConsolidationReview(orgId: string, actorId: string) {
  const roster = useApiListQuery(peopleQuery(orgId));
  const [survivor, setSurvivor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useAppRouter();
  const { preview, merge } = useConsolidationRequests(orgId, actorId);
  const review = async (): Promise<void> => {
    setError(null);
    try {
      await preview.mutateAsync(survivor);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not review these people.'));
    }
  };
  const confirm = async (): Promise<void> => {
    if (!preview.data || merge.isPending) return;
    setError(null);
    try {
      await merge.mutateAsync(survivor);
      router.replace(`/orgs/${orgId}/people/${survivor}`);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not combine these people.'));
    }
  };
  const source = roster.data?.items.find((person) => person.actorId === actorId);
  return { roster, survivor, setSurvivor, error, preview, merge, review, confirm, source };
}
type ConsolidationState = ReturnType<typeof useConsolidationReview>;
function ConsolidationReview({ orgId, actorId }: { orgId: string; actorId: string }): JSX.Element {
  const state = useConsolidationReview(orgId, actorId);
  return (
    <div className="flex flex-col gap-3">
      <Text token="title-small">Combine duplicate person</Text>
      {state.source?.userId ? (
        <Text token="body-small">
          Open the duplicate person without account access and choose this person as the record to
          keep.
        </Text>
      ) : (
        <ConsolidationChoices actorId={actorId} state={state} />
      )}
      {state.error ? (
        <Text role="alert" token="body-small" tone="error">
          {state.error}
        </Text>
      ) : null}
    </div>
  );
}
function ConsolidationChoices({
  actorId,
  state,
}: {
  actorId: string;
  state: ConsolidationState;
}): JSX.Element {
  return (
    <>
      <Text token="body-small">
        Choose the person to keep. Existing work and references will follow that person.
      </Text>
      <Select
        aria-label="Person to keep"
        value={state.survivor}
        onChange={(event) => {
          state.setSurvivor(event.target.value);
          state.preview.reset();
        }}
        disabled={state.merge.isPending || state.preview.isPending}
      >
        <option value="">Choose a person</option>
        {state.roster.data?.items
          .filter((person) => person.actorId !== actorId)
          .map((person) => (
            <option key={person.actorId} value={person.actorId}>
              {person.displayName}
            </option>
          ))}
      </Select>
      {state.preview.data ? (
        <ConsolidationConfirmation state={state} />
      ) : (
        <Button
          type="button"
          disabled={!state.survivor || state.preview.isPending}
          onClick={() => {
            void state.review();
          }}
        >
          {state.preview.isPending ? 'Loading…' : 'Review combination'}
        </Button>
      )}
    </>
  );
}
function ConsolidationConfirmation({ state }: { state: ConsolidationState }): JSX.Element | null {
  const data = state.preview.data;
  if (!data) return null;
  return (
    <>
      <Text token="body-small">
        Combine {data.sourceName} into {data.survivorName}. This moves {data.assignments} task
        assignments, {data.projects} projects, {data.initiatives} initiatives, and {data.programs}{' '}
        programs.
      </Text>
      <Text token="body-small">
        {data.linkedIdentities.length} linked identities will be retained. Historical references
        will continue to work.
      </Text>
      <ul className="flex flex-col gap-2" aria-label="Identities to retain">
        {data.linkedIdentities.map((identity) => (
          <li key={identity.id}>
            <Text token="body-small">{identity.displayName ?? identity.externalId}</Text>
            <Text token="body-small" tone="muted">
              {identity.externalId} ·{' '}
              {identity.actorId === data.sourceActorId ? data.sourceName : data.survivorName}
            </Text>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        autoFocus
        disabled={state.merge.isPending}
        onClick={() => {
          void state.confirm();
        }}
      >
        {state.merge.isPending ? 'Combining…' : 'Confirm combination'}
      </Button>
    </>
  );
}

function useConsolidationRequests(orgId: string, actorId: string) {
  const preview = useApiMutation({
    mutationFn: (survivorActorId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members[':actorId']['consolidation-preview'].$post({
            param: { orgId, actorId },
            json: { survivorActorId: ActorId.parse(survivorActorId) },
          }),
        'Could not review these people.',
      ),
  });
  const merge = useApiMutation({
    mutationFn: (survivorActorId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members[':actorId'].consolidate.$post({
            param: { orgId, actorId },
            json: {
              survivorActorId: ActorId.parse(survivorActorId),
              previewRevision: preview.data?.previewRevision ?? '',
            },
          }),
        'Could not combine these people.',
      ),
    invalidateKeys: [['org', orgId]],
  });
  return { preview, merge };
}
