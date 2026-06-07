'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { ErrorBanner, LifecycleBadge, PageHeader } from '@/components/ui-bits';
import { api } from '@/lib/api';
import {
  LIFECYCLE_STATES,
  type LifecycleState,
  formatTimestamp,
  lifecycleLabel,
} from '@/lib/lifecycle';
import { readError, readProblem } from '@/lib/problem';
import type { AdminHold, AdminOrg } from '@/lib/types';

/**
 * The organization detail screen with inline billing actions and lifecycle holds.
 *
 * @remarks
 * A Client Component. Reads `GET /v1/admin/orgs/:id` at runtime. Billing actions (finance+
 * on the API) post to `extend-trial`, `reactivate`, and `lifecycle`; each refreshes the org
 * from the response. Holds are placed via `POST .../holds` and released via
 * `DELETE .../holds/:holdId`. The admin API exposes no holds-list endpoint, so the holds
 * panel reflects holds placed during this session (and releases them); a placed hold is
 * surfaced immediately from the create response. A 403 (insufficient tier or non-staff)
 * surfaces inline on each action.
 */
export default function OrgDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [org, setOrg] = useState<AdminOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const [trialDays, setTrialDays] = useState('14');
  const [targetState, setTargetState] = useState<LifecycleState>('active');

  const [holds, setHolds] = useState<readonly AdminHold[]>([]);
  const [holdReason, setHoldReason] = useState('');

  /** Load the org detail. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.v1.admin.orgs[':id'].$get({ param: { id: params.id } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not load this organization.'));
        return;
      }
      setOrg(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading this organization.'));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a billing/lifecycle action that returns the updated org, tracking pending + errors. */
  const runOrgAction = useCallback(
    async (key: string, call: () => Promise<Response>, failMessage: string): Promise<void> => {
      setActionError(null);
      setPending(key);
      try {
        const res = await call();
        if (!res.ok) {
          setActionError(await readProblem(res, failMessage));
          return;
        }
        setOrg((await res.json()) as AdminOrg);
      } catch (caught) {
        setActionError(readError(caught, failMessage));
      } finally {
        setPending(null);
      }
    },
    [],
  );

  /** Extend the trial by the entered number of days. */
  function extendTrial(): void {
    void runOrgAction(
      'extend-trial',
      () =>
        api.v1.admin.orgs[':id']['extend-trial'].$post({
          param: { id: params.id },
          json: { days: Number(trialDays) },
        }),
      'Could not extend the trial.',
    );
  }

  /** Reactivate the org (back to active/trialing through the billing service). */
  function reactivate(): void {
    void runOrgAction(
      'reactivate',
      () => api.v1.admin.orgs[':id'].reactivate.$post({ param: { id: params.id } }),
      'Could not reactivate the organization.',
    );
  }

  /** Force the org into the selected lifecycle state. */
  function setLifecycle(): void {
    void runOrgAction(
      'lifecycle',
      () =>
        api.v1.admin.orgs[':id'].lifecycle.$post({
          param: { id: params.id },
          json: { lifecycleState: targetState },
        }),
      'Could not set the lifecycle state.',
    );
  }

  /** Place a lifecycle hold with the entered reason. */
  async function placeHold(): Promise<void> {
    setActionError(null);
    setPending('place-hold');
    try {
      const res = await api.v1.admin.orgs[':id'].holds.$post({
        param: { id: params.id },
        json: { reason: holdReason },
      });
      if (!res.ok) {
        setActionError(await readProblem(res, 'Could not place the hold.'));
        return;
      }
      const hold = await res.json();
      setHolds((prev) => [hold, ...prev]);
      setHoldReason('');
    } catch (caught) {
      setActionError(readError(caught, 'Something went wrong placing the hold.'));
    } finally {
      setPending(null);
    }
  }

  /** Release an active hold. */
  async function releaseHold(holdId: string): Promise<void> {
    setActionError(null);
    setPending(`release-${holdId}`);
    try {
      const res = await api.v1.admin.orgs[':id'].holds[':holdId'].$delete({
        param: { id: params.id, holdId },
      });
      if (!res.ok) {
        setActionError(await readProblem(res, 'Could not release the hold.'));
        return;
      }
      setHolds((prev) => prev.filter((h) => h.id !== holdId));
    } catch (caught) {
      setActionError(readError(caught, 'Something went wrong releasing the hold.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <Link
        href="/orgs"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Back to organizations
      </Link>

      {loading ? (
        <DetailSkeleton />
      ) : org ? (
        <>
          <PageHeader
            title={org.name}
            description={org.slug}
            actions={<LifecycleBadge state={org.lifecycleState} />}
          />
          <ErrorBanner message={error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Organization ID" value={org.id} mono />
              <Field label="Type" value={org.isPersonal ? 'Personal' : 'Team'} />
              <Field label="Created" value={formatTimestamp(org.createdAt)} />
              <Field label="Export ready" value={formatTimestamp(org.exportReadyAt)} />
              <Field label="Delete after" value={formatTimestamp(org.deleteAfterAt)} />
            </CardContent>
          </Card>

          <ErrorBanner message={actionError} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Billing actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="trial-days" className="text-muted-foreground text-xs font-medium">
                  Extend trial
                </label>
                <div className="flex gap-2">
                  <Input
                    id="trial-days"
                    type="number"
                    min={1}
                    max={365}
                    value={trialDays}
                    onChange={(e) => {
                      setTrialDays(e.target.value);
                    }}
                    className="w-28"
                  />
                  <Button variant="outline" disabled={pending !== null} onClick={extendTrial}>
                    {pending === 'extend-trial' ? 'Extending…' : 'Extend trial'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs font-medium">Reactivate</span>
                <div>
                  <Button variant="outline" disabled={pending !== null} onClick={reactivate}>
                    {pending === 'reactivate' ? 'Reactivating…' : 'Reactivate'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="target-state" className="text-muted-foreground text-xs font-medium">
                  Set lifecycle state
                </label>
                <div className="flex gap-2">
                  <select
                    id="target-state"
                    value={targetState}
                    onChange={(e) => {
                      setTargetState(e.target.value as LifecycleState);
                    }}
                    className="border-input focus-visible:ring-ring h-9 rounded-md border bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                  >
                    {LIFECYCLE_STATES.map((state) => (
                      <option key={state} value={state}>
                        {lifecycleLabel(state)}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" disabled={pending !== null} onClick={setLifecycle}>
                    {pending === 'lifecycle' ? 'Setting…' : 'Set state'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Lifecycle holds</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-xs">
                A hold blocks automated lifecycle progression (export, deletion) until released.
              </p>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void placeHold();
                }}
              >
                <Input
                  value={holdReason}
                  onChange={(e) => {
                    setHoldReason(e.target.value);
                  }}
                  placeholder="Reason for the hold"
                  required
                  aria-label="Reason for the hold"
                  className="flex-1"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={pending !== null || holdReason.trim().length === 0}
                >
                  {pending === 'place-hold' ? 'Placing…' : 'Place hold'}
                </Button>
              </form>
              {holds.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {holds.map((hold) => (
                    <li
                      key={hold.id}
                      className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{hold.reason}</p>
                        <p className="text-muted-foreground text-xs">
                          Placed {formatTimestamp(hold.createdAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => void releaseHold(hold.id)}
                      >
                        {pending === `release-${hold.id}` ? 'Releasing…' : 'Release'}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">No holds placed in this session.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <ErrorBanner message={error} />
      )}
    </div>
  );
}

/** A labeled read-only field in the overview card. */
function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className={`text-sm ${mono ? 'truncate font-mono text-xs' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

/** A loading placeholder for the org detail screen. */
function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 rounded-md" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
