/**
 * Data hooks for Athena's email-derived task suggestions, shown inline in triage.
 *
 * @remarks
 * Reads the pending suggestion queue and exposes accept / dismiss. Accepting materializes a
 * real task (so it also invalidates the org's task list, which feeds the triage queue) and
 * honors edit-then-accept field overrides; dismissing discards it. A suggestion is never a
 * task until accepted. {@link useEmailSuggestionThread} lazily fetches the source thread
 * live from the mail provider for the card's preview expander (bodies are never persisted
 * server-side). See `docs/engineering/specs/email-to-task.md` §2/§9.
 */
import type { EmailSuggestionOut, EmailThreadOut, SuggestionAcceptBody } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { userErrorMessage } from './problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from './query';

/** One accept call: the suggestion id plus optional edit-then-accept field overrides. */
export interface AcceptSuggestionArgs {
  id: string;
  /** Field overrides the user edited before accepting (empty = accept as suggested). */
  overrides: SuggestionAcceptBody;
}

/** All suggestion data + mutation callbacks for the triage lane. */
export interface EmailSuggestionsData {
  suggestions: readonly EmailSuggestionOut[];
  isPending: boolean;
  accept: (args: AcceptSuggestionArgs) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  actionError: string | null;
}

/**
 * Fetch the pending email-suggestion queue and expose accept / dismiss writes.
 *
 * @param orgId - The active organization id.
 */
export function useEmailSuggestions(orgId: string): EmailSuggestionsData {
  const key = useMemo<QueryKey>(() => queryKeys.emailSuggestions(orgId), [orgId]);

  const listQ = useApiQuery(
    apiQueryOptions(
      key,
      () => api.v1.orgs[':orgId']['email-suggestions'].$get({ param: { orgId } }),
      'Could not load suggestions.',
    ),
  );

  const acceptM = useApiMutation({
    mutationFn: ({ id, overrides }: AcceptSuggestionArgs) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['email-suggestions'][':id'].accept.$post({
            param: { orgId, id },
            json: overrides,
          }),
        'Could not accept the suggestion.',
      ),
    // Accept materializes a task — refresh both the suggestion lane and the task list/queue.
    invalidateKeys: [key, queryKeys.tasks(orgId)],
  });

  const dismissM = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['email-suggestions'][':id'].dismiss.$post({ param: { orgId, id } }),
        'Could not dismiss the suggestion.',
      ),
    invalidateKeys: [key],
  });

  return {
    suggestions: listQ.data?.items ?? [],
    isPending: listQ.isPending,
    accept: async (args) => void (await acceptM.mutateAsync(args)),
    dismiss: async (id) => void (await dismissM.mutateAsync(id)),
    actionError: acceptM.error
      ? userErrorMessage(acceptM.error, 'Could not accept that suggestion.')
      : dismissM.error
        ? userErrorMessage(dismissM.error, 'Could not dismiss that suggestion.')
        : null,
  };
}

/** The lazily-fetched source thread for one suggestion card. */
export interface EmailSuggestionThreadData {
  thread: EmailThreadOut | undefined;
  isPending: boolean;
  error: string | null;
}

/**
 * Fetch a suggestion's source-email thread live from the mail provider — lazily, only once
 * the card's preview is expanded (`enabled`), since each fetch is a provider round-trip.
 *
 * @param orgId - The active organization id.
 * @param suggestionId - The suggestion whose thread to fetch.
 * @param enabled - Gate: fetch only while the preview is expanded.
 */
export function useEmailSuggestionThread(
  orgId: string,
  suggestionId: string,
  enabled: boolean,
): EmailSuggestionThreadData {
  const key = useMemo<QueryKey>(
    () => queryKeys.emailSuggestionThread(orgId, suggestionId),
    [orgId, suggestionId],
  );

  const threadQ = useApiQuery({
    ...apiQueryOptions(
      key,
      () =>
        api.v1.orgs[':orgId']['email-suggestions'][':id'].thread.$get({
          param: { orgId, id: suggestionId },
        }),
      'Could not load the email thread.',
    ),
    enabled,
  });

  return {
    thread: threadQ.data,
    isPending: enabled && threadQ.isPending,
    error: threadQ.error
      ? userErrorMessage(threadQ.error, 'Could not load the source email.')
      : null,
  };
}
