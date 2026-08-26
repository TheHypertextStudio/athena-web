'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';

import { api } from '@/lib/api';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';
import type { AdminOrg, AdminOrgBillingState } from '@/lib/types';

type PartnerPreview = InferResponseType<
  (typeof api.admin.orgs)[':id']['discount-awards']['preview']['$post']
>;

/** All state + actions for the org detail screen. */
export interface OrgDetailData {
  org: AdminOrg | null;
  billing: AdminOrgBillingState | null;
  loading: boolean;
  error: string | null;
  authFailed: boolean;
  actionError: string | null;
  pending: string | null;
  trialDays: string;
  setTrialDays: (v: string) => void;
  complimentaryReason: string;
  setComplimentaryReason: (v: string) => void;
  partnerPercent: string;
  setPartnerPercent: (v: string) => void;
  partnerEndsAt: string;
  setPartnerEndsAt: (v: string) => void;
  partnerReason: string;
  setPartnerReason: (v: string) => void;
  partnerPreview: PartnerPreview | null;
  load: () => Promise<void>;
  reconcileStripe: () => void;
  extendTrial: () => void;
  grantComplimentary: () => void;
  revokeComplimentary: () => void;
  grantPartnerDiscount: () => void;
  previewPartnerDiscount: () => void;
  renewPartnerDiscount: () => void;
  revokeDiscount: () => void;
}

/** useOrgDetail coordinates use org detail state, loading, and mutations for its screen. */
export function useOrgDetail(orgId: string): OrgDetailData {
  const [org, setOrg] = useState<AdminOrg | null>(null);
  const [billing, setBilling] = useState<AdminOrgBillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState('14');
  const [complimentaryReason, setComplimentaryReason] = useState('Founder production access');
  const [partnerPercent, setPartnerPercent] = useState('25');
  const [partnerEndsAt, setPartnerEndsAt] = useState(() => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [partnerReason, setPartnerReason] = useState('');
  const [partnerPreview, setPartnerPreview] = useState<PartnerPreview | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const [res, billingRes] = await Promise.all([
        api.admin.orgs[':id'].$get({ param: { id: orgId } }),
        api.admin.orgs[':id']['billing-state'].$get({ param: { id: orgId } }),
      ]);
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await userProblemMessage(res, 'Could not load this organization.'));
        return;
      }
      if (!billingRes.ok) {
        setAuthFailed(isAuthError(billingRes));
        setError(await userProblemMessage(billingRes, 'Could not load this billing account.'));
        return;
      }
      setOrg(await res.json());
      setBilling(await billingRes.json());
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

  const reconcileStripe = useCallback((): void => {
    void (async () => {
      setActionError(null);
      setPending('reconcile-stripe');
      try {
        const response = await api.admin.orgs[':id'].reconcile.$post({
          param: { id: orgId },
        });
        if (!response.ok) {
          setActionError(
            await userProblemMessage(response, 'Could not reconcile Stripe billing state.'),
          );
          return;
        }
        await load();
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Could not reconcile Stripe billing state.'));
      } finally {
        setPending(null);
      }
    })();
  }, [load, orgId]);

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

  const grantPartnerDiscount = useCallback((): void => {
    void (async () => {
      setActionError(null);
      setPending('grant-partner-discount');
      try {
        const response = await api.admin.orgs[':id']['discount-awards'].$post({
          param: { id: orgId },
          json: {
            percentOff: Number(partnerPercent),
            endsAt: new Date(`${partnerEndsAt}T23:59:59.000Z`).toISOString(),
            reason: partnerReason,
            confirmation: partnerPreview?.confirmation ?? '',
          },
        });
        if (!response.ok) {
          setActionError(
            await userProblemMessage(response, 'Could not grant the partner discount.'),
          );
          return;
        }
        setPartnerReason('');
        setPartnerPreview(null);
        await load();
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Could not grant the partner discount.'));
      } finally {
        setPending(null);
      }
    })();
  }, [load, orgId, partnerEndsAt, partnerPercent, partnerPreview, partnerReason]);

  const previewPartnerDiscount = useCallback((): void => {
    void (async () => {
      setActionError(null);
      setPending('preview-partner-discount');
      try {
        const response = await api.admin.orgs[':id']['discount-awards'].preview.$post({
          param: { id: orgId },
          json: {
            percentOff: Number(partnerPercent),
            endsAt: new Date(`${partnerEndsAt}T23:59:59.000Z`).toISOString(),
            reason: partnerReason,
          },
        });
        if (!response.ok) {
          setActionError(
            await userProblemMessage(response, 'Could not preview the partner discount.'),
          );
          return;
        }
        setPartnerPreview(await response.json());
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Could not preview the partner discount.'));
      } finally {
        setPending(null);
      }
    })();
  }, [orgId, partnerEndsAt, partnerPercent, partnerReason]);

  const changeCurrentAward = useCallback(
    (action: 'renew' | 'revoke'): void => {
      if (!billing?.award) return;
      const award = billing.award;
      void (async () => {
        setActionError(null);
        setPending(`${action}-discount`);
        try {
          const awardRoutes = api.admin['discount-applications'].awards[':awardId'];
          const response =
            action === 'renew'
              ? await awardRoutes.renewals.$post({
                  param: { awardId: award.id },
                  json: {
                    reason: partnerReason,
                    endsAt: new Date(`${partnerEndsAt}T23:59:59.000Z`).toISOString(),
                  },
                })
              : await awardRoutes.revocations.$post({
                  param: { awardId: award.id },
                  json: { reason: partnerReason },
                });
          if (!response.ok) {
            setActionError(
              await userProblemMessage(response, `Could not ${action} the current discount.`),
            );
            return;
          }
          setPartnerReason('');
          setPartnerPreview(null);
          await load();
        } catch (caught) {
          setActionError(userErrorMessage(caught, `Could not ${action} the current discount.`));
        } finally {
          setPending(null);
        }
      })();
    },
    [billing?.award, load, partnerEndsAt, partnerReason],
  );

  const renewPartnerDiscount = useCallback((): void => {
    changeCurrentAward('renew');
  }, [changeCurrentAward]);

  const revokeDiscount = useCallback((): void => {
    changeCurrentAward('revoke');
  }, [changeCurrentAward]);

  return {
    org,
    billing,
    loading,
    error,
    authFailed,
    actionError,
    pending,
    trialDays,
    setTrialDays,
    complimentaryReason,
    setComplimentaryReason,
    partnerPercent,
    setPartnerPercent: (value) => {
      setPartnerPercent(value);
      setPartnerPreview(null);
    },
    partnerEndsAt,
    setPartnerEndsAt: (value) => {
      setPartnerEndsAt(value);
      setPartnerPreview(null);
    },
    partnerReason,
    setPartnerReason: (value) => {
      setPartnerReason(value);
      setPartnerPreview(null);
    },
    partnerPreview,
    load,
    reconcileStripe,
    extendTrial,
    grantComplimentary,
    revokeComplimentary,
    grantPartnerDiscount,
    previewPartnerDiscount,
    renewPartnerDiscount,
    revokeDiscount,
  };
}
