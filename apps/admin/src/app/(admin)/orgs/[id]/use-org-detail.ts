'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';
import type { AdminHold, AdminOrg } from '@/lib/types';

/** All state + actions for the org detail screen. */
export interface OrgDetailData {
  org: AdminOrg | null;
  loading: boolean;
  error: string | null;
  authFailed: boolean;
  actionError: string | null;
  pending: string | null;
  trialDays: string;
  setTrialDays: (v: string) => void;
  complimentaryReason: string;
  setComplimentaryReason: (v: string) => void;
  holds: readonly AdminHold[];
  holdReason: string;
  setHoldReason: (v: string) => void;
  load: () => Promise<void>;
  extendTrial: () => void;
  grantComplimentary: () => void;
  revokeComplimentary: () => void;
  placeHold: () => Promise<void>;
  releaseHold: (holdId: string) => Promise<void>;
}

/** useOrgDetail coordinates use org detail state, loading, and mutations for its screen. */
export function useOrgDetail(orgId: string): OrgDetailData {
  const [org, setOrg] = useState<AdminOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState('14');
  const [complimentaryReason, setComplimentaryReason] = useState('Founder production access');
  const [holds, setHolds] = useState<readonly AdminHold[]>([]);
  const [holdReason, setHoldReason] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.orgs[':id'].$get({ param: { id: orgId } });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await userProblemMessage(res, 'Could not load this organization.'));
        return;
      }
      setOrg(await res.json());
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong loading this organization.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runOrgAction = useCallback(
    async (key: string, call: () => Promise<Response>, failMessage: string): Promise<void> => {
      setActionError(null);
      setPending(key);
      try {
        const res = await call();
        if (!res.ok) {
          setActionError(await userProblemMessage(res, failMessage));
          return;
        }
        setOrg((await res.json()) as AdminOrg);
      } catch (caught) {
        setActionError(userErrorMessage(caught, failMessage));
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const extendTrial = useCallback((): void => {
    void runOrgAction(
      'extend-trial',
      () =>
        api.admin.orgs[':id']['extend-trial'].$post({
          param: { id: orgId },
          json: { days: Number(trialDays) },
        }),
      'Could not extend the trial.',
    );
  }, [orgId, runOrgAction, trialDays]);

  const changeComplimentary = useCallback(
    async (grant: boolean): Promise<void> => {
      setActionError(null);
      setPending(grant ? 'grant-complimentary' : 'revoke-complimentary');
      try {
        const request = {
          param: { id: orgId },
          json: { reason: complimentaryReason },
        };
        const res = grant
          ? await api.admin.orgs[':id']['billing-exemption'].$post(request)
          : await api.admin.orgs[':id']['billing-exemption'].$delete(request);
        if (!res.ok) {
          setActionError(
            await userProblemMessage(
              res,
              grant
                ? 'Could not grant complimentary Docket Pro.'
                : 'Could not revoke complimentary Docket Pro.',
            ),
          );
          return;
        }
        await load();
      } catch (caught) {
        setActionError(
          userErrorMessage(
            caught,
            grant
              ? 'Something went wrong granting complimentary Docket Pro.'
              : 'Something went wrong revoking complimentary Docket Pro.',
          ),
        );
      } finally {
        setPending(null);
      }
    },
    [complimentaryReason, load, orgId],
  );

  const grantComplimentary = useCallback((): void => {
    void changeComplimentary(true);
  }, [changeComplimentary]);

  const revokeComplimentary = useCallback((): void => {
    void changeComplimentary(false);
  }, [changeComplimentary]);

  const placeHold = useCallback(async (): Promise<void> => {
    setActionError(null);
    setPending('place-hold');
    try {
      const res = await api.admin.orgs[':id'].holds.$post({
        param: { id: orgId },
        json: { reason: holdReason },
      });
      if (!res.ok) {
        setActionError(await userProblemMessage(res, 'Could not place the hold.'));
        return;
      }
      const hold = await res.json();
      setHolds((prev) => [hold, ...prev]);
      setHoldReason('');
    } catch (caught) {
      setActionError(userErrorMessage(caught, 'Something went wrong placing the hold.'));
    } finally {
      setPending(null);
    }
  }, [holdReason, orgId]);

  const releaseHold = useCallback(
    async (holdId: string): Promise<void> => {
      setActionError(null);
      setPending(`release-${holdId}`);
      try {
        const res = await api.admin.orgs[':id'].holds[':holdId'].$delete({
          param: { id: orgId, holdId },
        });
        if (!res.ok) {
          setActionError(await userProblemMessage(res, 'Could not release the hold.'));
          return;
        }
        setHolds((prev) => prev.filter((h) => h.id !== holdId));
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Something went wrong releasing the hold.'));
      } finally {
        setPending(null);
      }
    },
    [orgId],
  );

  return {
    org,
    loading,
    error,
    authFailed,
    actionError,
    pending,
    trialDays,
    setTrialDays,
    complimentaryReason,
    setComplimentaryReason,
    holds,
    holdReason,
    setHoldReason,
    load,
    extendTrial,
    grantComplimentary,
    revokeComplimentary,
    placeHold,
    releaseHold,
  };
}
