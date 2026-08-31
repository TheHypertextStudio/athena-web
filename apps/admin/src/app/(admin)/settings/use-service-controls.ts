'use client';

import type { InferResponseType } from 'hono/client';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';

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
  /** The controls as last confirmed by the API, or `null` before the first load succeeds. */
  controls: ServiceControls | null;
  /** Whether the initial read is still in flight. */
  loading: boolean;
  /** Application-owned copy for a failed load. */
  error: string | null;
  /** Whether the failed load was an authentication or authorization failure. */
  authFailed: boolean;
  /** Application-owned copy for a failed change. */
  actionError: string | null;
  /** The control whose change is in flight, or `null` when the screen is idle. */
  pending: ServiceControlField | null;
  /** Re-read the current controls. */
  load: () => Promise<void>;
  /** Store a new value for one control, keeping the screen on the confirmed state until it lands. */
  setControl: (field: ServiceControlField, enabled: boolean) => void;
}

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
 * The rendered value always comes from a response the API confirmed: a rejected change leaves the
 * previous state in place and surfaces application-owned copy, so a control never appears to have
 * moved when nothing was stored.
 *
 * @returns See {@link ServiceControlsData}.
 */
export function useServiceControls(): ServiceControlsData {
  const [controls, setControls] = useState<ServiceControls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<ServiceControlField | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const response = await api.admin['service-controls'].$get();
      if (!response.ok) {
        setAuthFailed(isAuthError(response));
        setError(await userProblemMessage(response, 'Could not load the service controls.'));
        return;
      }
      setControls(await response.json());
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not load the service controls.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setControl = useCallback((field: ServiceControlField, enabled: boolean): void => {
    void (async () => {
      setActionError(null);
      setPending(field);
      try {
        const response = await api.admin['service-controls'].$patch({
          json: controlPatch(field, enabled),
        });
        if (!response.ok) {
          setActionError(
            await userProblemMessage(
              response,
              'Could not change this control. It is unchanged for everyone.',
            ),
          );
          return;
        }
        setControls(await response.json());
      } catch (caught) {
        setActionError(
          userErrorMessage(caught, 'Could not change this control. It is unchanged for everyone.'),
        );
      } finally {
        setPending(null);
      }
    })();
  }, []);

  return { controls, loading, error, authFailed, actionError, pending, load, setControl };
}
