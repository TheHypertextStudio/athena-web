'use client';

import { EmptyState, IdentityGlyph } from '@docket/ui/components';
import { Building } from '@docket/ui/icons';
import { Skeleton, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { LifecycleBadge } from '@/components/lifecycle-badge';
import { api } from '@/lib/api';
import { lifecycleLabel } from '@/lib/lifecycle';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminMetrics, AdminOrg } from '@/lib/types';
import { metricsDef } from '@/lib/use-admin-queues';

/** How many rows a retention queue shows before it defers to the organization list. */
const QUEUE_PREVIEW = 5;

/** The organizations scheduled for deletion. */
const pendingDeletionDef = apiQueryOptions(
  queryKeys.orgList({ lifecycleState: 'pending_deletion' }),
  () =>
    api.admin.orgs.$get({
      query: {
        lifecycleState: 'pending_deletion',
        limit: String(QUEUE_PREVIEW),
        offset: '0',
      },
    }),
  'Could not load the deletion queue.',
);

/** The organizations still carrying the legacy export marker. */
const exportWindowDef = apiQueryOptions(
  queryKeys.orgList({ lifecycleState: 'export_window' }),
  () =>
    api.admin.orgs.$get({
      query: { lifecycleState: 'export_window', limit: String(QUEUE_PREVIEW), offset: '0' },
    }),
  'Could not load the export-marker queue.',
);

/**
 * The operator dashboard — the default authenticated landing.
 *
 * @remarks
 * Reads the same metrics definition the sidebar's queue badges use, so the number on a nav badge
 * and the number on this screen come from one request and one cache entry rather than two reads
 * that can disagree.
 *
 * The service signals (`metrics.queues`) are rendered here for the first time. The API has always
 * computed stuck approvals, failed agent sessions, session volume, and active retention holds, and
 * the dashboard has always discarded them.
 */
export default function DashboardPage(): JSX.Element {
  const metrics = useApiQuery(metricsDef);
  const pendingDeletion = useApiQuery(pendingDeletionDef);
  const exportWindow = useApiQuery(exportWindowDef);

  return (
    <AdminPage width="list">
      <AdminPageHeader
        title="Operator dashboard"
        description="Platform health and the organizations that need attention."
      />

      <QueryErrorBanner
        error={metrics.error}
        fallback="Could not load the dashboard."
        onRetry={() => void metrics.refetch()}
      />

      <div className="grid gap-8 @4xl:grid-cols-[1.4fr_1fr]">
        <AsyncContent
          loading={metrics.isPending}
          empty={metrics.data === undefined}
          skeleton={<MetricSkeleton />}
          emptyState={<MetricSkeleton />}
        >
          {metrics.data ? <PlatformMetrics metrics={metrics.data} /> : null}
        </AsyncContent>

        <Stack gap={6}>
          <AdminSection title="Pending deletion">
            <OrgQueue
              query={pendingDeletion}
              emptyTitle="Nothing scheduled"
              emptyBody="No organization is queued for deletion."
            />
          </AdminSection>

          <AdminSection title="Legacy export marker">
            <OrgQueue
              query={exportWindow}
              emptyTitle="No markers"
              emptyBody="No organization carries the legacy export marker."
            />
          </AdminSection>
        </Stack>
      </div>
    </AdminPage>
  );
}

/** Every headline count the dashboard reports, grouped by what it describes. */
function PlatformMetrics({ metrics }: { readonly metrics: AdminMetrics }): JSX.Element {
  return (
    <Stack gap={6}>
      <AdminSection title="Platform">
        <MetricGrid>
          <Metric label="Users" value={metrics.totalUsers} />
          <Metric label="Organizations" value={metrics.totalOrgs} />
        </MetricGrid>
      </AdminSection>

      <AdminSection
        title="Service"
        description="What Athena is doing across every organization right now."
      >
        <MetricGrid>
          <Metric label="Awaiting approval" value={metrics.queues.stuckApprovals} />
          <Metric label="Failed sessions" value={metrics.queues.agentErrors} />
          <Metric label="Sessions run" value={metrics.queues.agentVolume} />
          <Metric label="Retention holds" value={metrics.queues.activeHolds} />
        </MetricGrid>
      </AdminSection>

      <AdminSection
        title="Organizations by state"
        description="Legacy retention markers. Billing access never advances these."
      >
        <MetricGrid>
          {metrics.orgsByLifecycle.map((bucket) => (
            <Metric
              key={bucket.lifecycleState}
              label={lifecycleLabel(bucket.lifecycleState)}
              value={bucket.count}
            />
          ))}
        </MetricGrid>
      </AdminSection>
    </Stack>
  );
}

/** The responsive grid every metric row shares. */
function MetricGrid({ children }: { readonly children: JSX.Element | JSX.Element[] }): JSX.Element {
  return <div className="grid grid-cols-2 gap-2 @xl:grid-cols-3">{children}</div>;
}

/** One headline count. */
function Metric({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1}>
        <Text as="p" token="label-small" tone="muted">
          {label}
        </Text>
        <Text as="p" token="headline-small" className="tabular-nums">
          {value.toLocaleString()}
        </Text>
      </Stack>
    </Surface>
  );
}

/** The shape of a retention-queue read, narrowed to what this screen needs. */
interface OrgQueueQuery {
  readonly data: { readonly items: readonly AdminOrg[] } | undefined;
  readonly isPending: boolean;
}

/** A short retention queue whose rows open the organization. */
function OrgQueue({
  query,
  emptyTitle,
  emptyBody,
}: {
  readonly query: OrgQueueQuery;
  readonly emptyTitle: string;
  readonly emptyBody: string;
}): JSX.Element {
  if (query.isPending) {
    return (
      <Stack gap={1} aria-hidden="true">
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </Stack>
    );
  }

  const orgs = query.data?.items ?? [];
  if (orgs.length === 0) {
    return <EmptyState icon={Building} title={emptyTitle} body={emptyBody} />;
  }

  return (
    <AdminList label="Organizations needing attention">
      {orgs.map((org) => (
        <AdminListRow
          key={org.id}
          href={`/orgs/${org.id}`}
          leading={
            <IdentityGlyph size={20}>
              <Building className="size-3" />
            </IdentityGlyph>
          }
          title={org.name}
          trailing={<LifecycleBadge state={org.lifecycleState} />}
        />
      ))}
    </AdminList>
  );
}

/** A loading placeholder sized to the metric grid. */
function MetricSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 @xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-[4.5rem] w-full rounded-lg" />
      ))}
    </div>
  );
}
