'use client';

import type { InferResponseType } from 'hono/client';

import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

import { apiQueryOptions, queryKeys, STALE, useApiMutation, useApiQuery } from '@/lib/query';

/**
 * The instance-wide service controls as reported by `GET /admin/service-controls`.
 *
 * @remarks
 * Inferred from the typed RPC contract rather than restated here, so the console's shape stays
 * in lockstep with the API at compile time.
 */
export type ServiceControls = InferResponseType<(typeof api.admin)['service-controls']['$get']>;

/** The name of one control within {@link ServiceControls}. */
export type ServiceControlField = keyof ServiceControls;

/** All state and actions the service-controls screen renders. */
export interface ServiceControlsData {
  /** The controls as last confirmed by the API, or `undefined` before the first load succeeds. */
  controls: ServiceControls | undefined;
  /** Whether the initial read is still in flight. */
  loading: boolean;
  /** The failed load, if the read failed. */
  error: Error | null;
  /** Re-read the current controls. */
  reload: () => void;
  /** The failed change, if the last change failed. */
  actionError: Error | null;
  /** The control whose change is in flight, or `null` when the screen is idle. */
  pending: ServiceControlField | null;
  /** Store a new value for one control, keeping the screen on the confirmed state until it lands. */
  setControl: (field: ServiceControlField, enabled: boolean) => void;
}

/** The instance-wide service controls. */
const controlsDef = apiQueryOptions(
  queryKeys.serviceControls(),
  () => api.admin['service-controls'].$get(),
  'Could not load the service controls.',
  { staleTime: STALE.static },
);

/**
 * Build the single-control request body for `PATCH /admin/service-controls`.
 *
 * @param field - The control being changed.
 * @param enabled - The value to store for it.
 * @returns A body naming only that control, so the other keeps its current value.
 */
function controlPatch(
  field: ServiceControlField,
  enabled: boolean,
): { latticeSubmissionsEnabled: boolean } | { latticePollingEnabled: boolean } {
  return field === 'latticeSubmissionsEnabled'
    ? { latticeSubmissionsEnabled: enabled }
    : { latticePollingEnabled: enabled };
}

/**
 * Coordinate reading and changing the instance-wide service controls.
 *
 * @remarks
 * The rendered value always comes from a response the API confirmed. There is deliberately no
 * optimistic update: these switches stop and start background work for every organization on the
 * instance, and a control that flips itself and then flips back is indistinguishable, in the moment
 * that matters, from one that stored the change. A rejected change leaves the previous state in
 * place and surfaces the failure.
 *
 * @returns See {@link ServiceControlsData}.
 */
export function useServiceControls(): ServiceControlsData {
  const queryClient = useQueryClient();
  const query = useApiQuery(controlsDef);

  const mutation = useApiMutation(
    (variables: { field: ServiceControlField; enabled: boolean }) =>
      api.admin['service-controls'].$patch({
        json: controlPatch(variables.field, variables.enabled),
      }),
    'Could not change this control. It is unchanged for everyone.',
    {
      // The PATCH response *is* the stored state, so adopt it directly. Relying on the invalidation
      // alone would leave the old value on screen until the re-read lands, so a switch someone just
      // turned off would still read as on for a moment — which, for a control that stops background
      // work across every organization, is the one moment it must not be wrong.
      // The PATCH response *is* the stored state, so adopt it directly and do not invalidate
      // afterwards: with an observer mounted, invalidating would refetch immediately and answer a
      // question the response just answered.
      onSuccess: (controls) => {
        queryClient.setQueryData(controlsDef.queryKey, controls);
      },
    },
  );

  return {
    controls: query.data,
    loading: query.isPending,
    error: query.error,
    reload: () => void query.refetch(),
    actionError: mutation.error,
    // Derived rather than mirrored in state: the mutation already knows what is in flight and what
    // it was called with, and a second copy can only disagree with it.
    pending: mutation.isPending ? mutation.variables.field : null,
    setControl: (field, enabled) => {
      mutation.mutate({ field, enabled });
    },
  };
}
