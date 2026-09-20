'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useActiveOrg } from '@/components/active-org';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { PersonCreateConfirmation } from '@/components/people/person-create-confirmation';
import { useAddPerson } from '@/components/people/people-queries';
import { userErrorMessage } from '@/lib/problem';
import type { MentionItem } from '@/lib/contracts/mention';
import type { CreatePersonMentionChoice } from './mention-choice';

/** A creation action and its explicit confirmation for the current mention query. */
export interface MentionPersonCreation {
  readonly choice: CreatePersonMentionChoice | undefined;
  readonly confirmation: ReactNode;
  readonly confirming: boolean;
  readonly cancel: () => void;
}

/** Create a person without abandoning the editor's current mention range. */
export function useMentionPersonCreation(
  orgId: string,
  query: string,
  onSelect: (item: MentionItem) => void,
  hasExactMatch = false,
): MentionPersonCreation {
  const { orgName } = useActiveOrg();
  const { canContribute } = useCanManageOrg(orgId);
  const create = useAddPerson(orgId);
  const state = useCreationAttempt(orgId);
  const { attempt, error, cancel, returnFocus, setError, setAttempt } = state;
  const name = query.trim();
  const choice = useMemo<CreatePersonMentionChoice | undefined>(() => {
    if (!canContribute || name.length === 0 || name.length > 120) return undefined;
    return {
      origin: 'create-person',
      id: 'create-person',
      title: hasExactMatch ? `Add another person named “${name}”` : `Add “${name}”`,
      select: () => {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setError(null);
        setAttempt({ name, requestId: crypto.randomUUID() });
      },
    };
  }, [canContribute, name, hasExactMatch, returnFocus, setError, setAttempt]);

  const confirm = (): Promise<void> => submitPersonCreation(state, create, orgId, onSelect);
  const confirmation =
    attempt === null ? null : (
      <PersonCreateConfirmation
        name={attempt.name}
        workspaceName={orgName(orgId)}
        busy={create.isPending}
        error={error}
        onConfirm={() => {
          void confirm();
        }}
        onCancel={cancel}
      />
    );
  return { choice, confirmation, confirming: attempt !== null, cancel };
}

function useCreationAttempt(orgId: string) {
  const [attempt, setAttempt] = useState<{ name: string; requestId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = useRef({ orgId, revision: 0 });
  if (origin.current.orgId !== orgId)
    origin.current = { orgId, revision: origin.current.revision + 1 };
  const alive = useRef(true);
  const busy = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setAttempt(null);
    setError(null);
  }, [orgId]);

  const cancel = useCallback(() => {
    if (busy.current) return;
    setAttempt(null);
    setError(null);
    returnFocus.current?.focus();
  }, []);
  return { attempt, error, cancel, busy, returnFocus, setError, setAttempt, origin, alive };
}

async function submitPersonCreation(
  state: ReturnType<typeof useCreationAttempt>,
  create: ReturnType<typeof useAddPerson>,
  orgId: string,
  onSelect: (item: MentionItem) => void,
): Promise<void> {
  const { attempt, busy, origin, alive, setError, setAttempt } = state;
  if (attempt === null || busy.current) return;
  busy.current = true;
  const revision = origin.current.revision;
  setError(null);
  try {
    const person = await create.mutateAsync({
      displayName: attempt.name,
      requestId: attempt.requestId,
    });
    if (!alive.current || origin.current.revision !== revision) return;
    onSelect({
      origin: 'local',
      id: `entity:actor:${person.actorId}`,
      entityKind: 'actor',
      ref: { kind: 'entity', entityKind: 'actor', entityId: person.actorId },
      title: person.displayName,
      subtitle: null,
      href: `/orgs/${orgId}/people/${person.actorId}`,
      score: 1,
    });
    setAttempt(null);
  } catch (caught) {
    if (alive.current && origin.current.revision === revision)
      setError(userErrorMessage(caught, 'Could not add this person.'));
  } finally {
    busy.current = false;
  }
}
