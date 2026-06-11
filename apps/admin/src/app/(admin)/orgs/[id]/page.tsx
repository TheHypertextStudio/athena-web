'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { LifecycleStateMenu } from '@/components/lifecycle-filter';
import { ErrorBanner, LifecycleBadge, PageHeader, SignInAction } from '@/components/ui-bits';
import { formatTimestamp } from '@/lib/lifecycle';
import { DetailSkeleton, Field } from './org-detail-ui';
import { useOrgDetail } from './use-org-detail';

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
  const {
    org,
    loading,
    error,
    authFailed,
    actionError,
    pending,
    trialDays,
    setTrialDays,
    targetState,
    setTargetState,
    holds,
    holdReason,
    setHoldReason,
    extendTrial,
    reactivate,
    setLifecycle,
    placeHold,
    releaseHold,
  } = useOrgDetail(params.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <Link
        href="/orgs"
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring text-body w-fit rounded-sm underline-offset-4 transition-colors hover:underline focus-visible:ring-1 focus-visible:outline-none"
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
              <CardTitle className="text-body">Overview</CardTitle>
            </CardHeader>
            <CardContent className="text-body grid grid-cols-2 gap-4 sm:grid-cols-3">
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
              <CardTitle className="text-body">Billing actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="trial-days" className="text-on-surface-variant text-xs font-medium">
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
                <span className="text-on-surface-variant text-xs font-medium">Reactivate</span>
                <div>
                  <Button variant="outline" disabled={pending !== null} onClick={reactivate}>
                    {pending === 'reactivate' ? 'Reactivating…' : 'Reactivate'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="target-state"
                  className="text-on-surface-variant text-xs font-medium"
                >
                  Set lifecycle state
                </label>
                <div className="flex gap-2">
                  <LifecycleStateMenu
                    id="target-state"
                    value={targetState}
                    onChange={setTargetState}
                  />
                  <Button variant="outline" disabled={pending !== null} onClick={setLifecycle}>
                    {pending === 'lifecycle' ? 'Setting…' : 'Set state'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-body">Lifecycle holds</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-on-surface-variant text-xs">
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
                      className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-body truncate">{hold.reason}</p>
                        <p className="text-on-surface-variant text-xs">
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
                <p className="text-on-surface-variant text-xs">No holds placed in this session.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />
      )}
    </div>
  );
}
