/**
 * Data hook for Athena's email-derived task suggestions, shown inline in triage.
 *
 * @remarks
 * Reads the pending suggestion queue and exposes accept / dismiss. Accepting materializes a
 * real task (so it also invalidates the org's task list, which feeds the triage queue);
 * dismissing discards it. A suggestion is never a task until accepted — see
 * `docs/engineering/specs/email-to-task.md` §2/§9.
 */
import type { EmailSuggestionOut } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from './query';

/** The stable React Query key for an org's pending email suggestions. */
export function emailSuggestionsKey(orgId: string): QueryKey {
  return ['org', orgId, 'email-suggestions'];
}

/** All suggestion data + mutation callbacks for the triage lane. */
export interface EmailSuggestionsData {
  suggestions: readonly EmailSuggestionOut[];
  isPending: boolean;
  accept: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  actionError: string | null;
}

/**
 * Fetch the pending email-suggestion queue and expose accept / dismiss writes.
 *
 * @param orgId - The active organization id.
 */
export function useEmailSuggestions(orgId: string): EmailSuggestionsData {
  const key = useMemo<QueryKey>(() => emailSuggestionsKey(orgId), [orgId]);

  const listQ = useApiQuery(
    apiQueryOptions(
      key,
      () => api.v1.orgs[':orgId']['email-suggestions'].$get({ param: { orgId } }),
      'Could not load suggestions.',
    ),
  );

  const acceptM = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['email-suggestions'][':id'].accept.$post({
            param: { orgId, id },
            json: {},
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
    accept: async (id) => void (await acceptM.mutateAsync(id)),
    dismiss: async (id) => void (await dismissM.mutateAsync(id)),
    actionError: acceptM.error?.message ?? dismissM.error?.message ?? null,
  };
}
