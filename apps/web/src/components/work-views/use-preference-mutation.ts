'use client';

/**
 * Persisting the personal work-view state list.
 *
 * @remarks
 * Its own module because it closes over nothing in the controller — and because the write it makes
 * replaces the stored `viewState` column whole, which is the reason callers must never issue it from
 * a read that failed. See `enqueuePreferenceWrite` in `use-work-view.ts`.
 */
import { HubPreferences } from '@docket/planning/hub-preferences-contract';
import type { PersonalWorkViewState as PersonalWorkViewStateValue } from '@docket/work/work-view-contract';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { validatedRpcResponse } from './validated-rpc-response';

/** Replace the caller's stored personal view-state list. */
export function usePreferenceMutation() {
  return useApiMutation<HubPreferences, readonly PersonalWorkViewStateValue[]>({
    mutationFn: (viewState) =>
      unwrap(
        () =>
          validatedRpcResponse(
            () => api.v1.hub.preferences.$patch({ json: { viewState: [...viewState] } }),
            HubPreferences,
          ),
        'Could not save your view preferences.',
      ),
    invalidateKeys: [queryKeys.hubPreferences()],
  });
}
