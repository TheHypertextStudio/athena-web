'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import {
  EmptyState,
  ErrorBanner,
  LifecycleBadge,
  PageHeader,
  ROW_CLASS,
  SignInAction,
} from '@/components/ui-bits';
import { api } from '@/lib/api';
import { lifecycleLabel } from '@/lib/lifecycle';
import { isAuthError, readError, readProblem } from '@/lib/problem';
import type { AdminMetrics, AdminOrg } from '@/lib/types';

/** The dashboard's loaded data: headline metrics and the at-risk org queues. */
interface DashboardData {
  /** Totals + per-lifecycle org counts from `GET /v1/admin/metrics`. */
  metrics: AdminMetrics;
  /** Orgs in the read-only export window (recently lapsed, recoverable). */
  exportWindow: readonly AdminOrg[];
  /** Orgs scheduled for deletion (the most urgent queue). */
  pendingDeletion: readonly AdminOrg[];
}

/**
 * The operator dashboard — the default authenticated landing.
 *
 * @remarks
 * A Client Component that fetches at runtime (no build-time API dependency). It loads the
 * headline metrics (`GET /v1/admin/metrics`) alongside the two "needs attention" queues —
 * orgs in `export_window` and `pending_deletion` — via filtered `GET /v1/admin/orgs`
 * lookups. The layout splits metrics (left) from the queues (right). A 403 from any call
 * (non-staff session) surfaces inline.
 */
export default function DashboardPage(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load metrics and the at-risk org queues in parallel. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const [metricsRes, exportRes, deleteRes] = await Promise.all([
        api.v1.admin.metrics.$get(),
        api.v1.admin.orgs.$get({
          query: { lifecycleState: 'export_window', limit: '5', offset: '0' },
        }),
        api.v1.admin.orgs.$get({
          query: { lifecycleState: 'pending_deletion', limit: '5', offset: '0' },
        }),
      ]);
      if (!metricsRes.ok) {
        setAuthFailed(isAuthError(metricsRes));
        setError(await readProblem(metricsRes, 'Could not load the dashboard.'));
        return;
      }
      const metrics = await metricsRes.json();
      const exportWindow = exportRes.ok ? (await exportRes.json()).items : [];
      const pendingDeletion = deleteRes.ok ? (await deleteRes.json()).items : [];
      setData({ metrics, exportWindow, pendingDeletion });
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading the dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8">
      <PageHeader
        title="Operator dashboard"
        description="Platform health and the organizations that need attention."
      />
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {loading ? (
        <DashboardSkeleton />
      ) : data ? (
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <section className="flex flex-col gap-4" aria-labelledby="metrics-heading">
            <h2 id="metrics-heading" className="text-on-surface-variant text-sm font-medium">
              Platform metrics
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Total users" value={data.metrics.totalUsers} />
              <MetricCard label="Total organizations" value={data.metrics.totalOrgs} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.metrics.orgsByLifecycle.map((bucket) => (
                <MetricCard
                  key={bucket.lifecycleState}
                  label={lifecycleLabel(bucket.lifecycleState)}
                  value={bucket.count}
                />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-4" aria-labelledby="queues-heading">
            <h2 id="queues-heading" className="text-on-surface-variant text-sm font-medium">
              Needs attention
            </h2>
            <OrgQueue
              title="Pending deletion"
              orgs={data.pendingDeletion}
              emptyMessage="No organizations scheduled for deletion."
            />
            <OrgQueue
              title="Export window"
              orgs={data.exportWindow}
              emptyMessage="No organizations in the export window."
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** A single headline-metric card. */
function MetricCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-on-surface-variant text-xs font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/** A titled queue of at-risk orgs, each linking to its detail screen. */
function OrgQueue({
  title,
  orgs,
  emptyMessage,
}: {
  title: string;
  orgs: readonly AdminOrg[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {orgs.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/orgs/${org.id}`}
                className={`${ROW_CLASS} items-center justify-between gap-3 rounded-lg px-3 py-2.5`}
              >
                <span className="min-w-0 truncate text-sm font-medium">{org.name}</span>
                <LifecycleBadge state={org.lifecycleState} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </div>
  );
}

/** A loading placeholder for the dashboard's two columns. */
function DashboardSkeleton(): JSX.Element {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
