'use client';

import { IdentityGlyph } from '@docket/ui/components';
import { Building } from '@docket/ui/icons';
import { Skeleton, Stack, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { AttentionBand } from './dashboard-attention';
import { LifecycleDistribution } from './dashboard-lifecycle';
import { ResourceUsage } from './dashboard-resources';
import { ServiceHealthSummary } from './dashboard-status';
import { LifecycleBadge } from '@/components/lifecycle-badge';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminMetrics, AdminOrg } from '@/lib/types';
import { metricsDef } from '@/lib/use-admin-queues';

/** How many rows a retention queue shows before it defers to the organization list. */
const QUEUE_PREVIEW = 5;

/**
 * What the deployment is consuming.
 *
 * @remarks
 * A slower tier than the queue signals beside it. These are aggregate scans rather than indexed
 * counts, and stored bytes do not move minute to minute.
 */
const resourcesDef = apiQueryOptions(
  queryKeys.resources(),
  () => api.admin.resources.$get(),
  'Could not load resource usage.',
  { staleTime: STALE.static },
);

/** Whether anything is currently broken. */
const statusDef = apiQueryOptions(
  queryKeys.status(),
  () => api.admin.status.$get(),
  'Could not load service status.',
  { staleTime: STALE.volatile },
);

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
  const resources = useApiQuery(resourcesDef);
  const status = useApiQuery(statusDef);

  return (
    <AdminPage width="list">
      <AdminPageHeader title="Operator dashboard" />

      {metrics.error ? (
        <QueryErrorBanner
          error={metrics.error}
          fallback="Could not load the dashboard."
          onRetry={() => void metrics.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={metrics.isPending}
        empty={metrics.data === undefined}
        skeleton={<AttentionSkeleton />}
        emptyState={<AttentionSkeleton />}
      >
        <AttentionBand metrics={metrics.data} />
      </AsyncContent>

      <AdminSection
        title="Service health"
        action={
          <Link href="/status" className="text-primary hover:underline">
            <Text as="span" token="label-medium">
              Full board
            </Text>
          </Link>
        }
      >
        <ServiceHealthSummary status={status.data} />
      </AdminSection>

      <div className="grid items-start gap-4 @4xl:grid-cols-[1fr_1fr]">
        <AdminSection title="Platform">
          <PlatformCounts metrics={metrics.data} />
        </AdminSection>

        <AdminSection title="Resource usage">
          <ResourceUsage resources={resources.data} />
        </AdminSection>

        <AdminSection title="Organizations by state">
          {metrics.data ? (
            <LifecycleDistribution buckets={metrics.data.orgsByLifecycle} />
          ) : (
            <Skeleton className="h-20 w-full rounded-lg" />
          )}
        </AdminSection>
      </div>

      <div className="grid gap-4 empty:hidden @4xl:grid-cols-[1fr_1fr]">
        <OrgQueue title="Pending deletion" query={pendingDeletion} />
        <OrgQueue title="Legacy export marker" query={exportWindow} />
      </div>
    </AdminPage>
  );
}

/** The steady-state totals: reference, not a call to action. */
function PlatformCounts({ metrics }: { readonly metrics: AdminMetrics | undefined }): JSX.Element {
  if (!metrics) return <Skeleton className="h-16 w-full rounded-lg" />;

  return (
    <div className="grid grid-cols-3 gap-4">
      <Metric label="Users" value={metrics.totalUsers} href="/users" />
      <Metric label="Organizations" value={metrics.totalOrgs} href="/orgs" />
      <Metric label="Sessions run" value={metrics.queues.agentVolume} />
    </div>
  );
}

/**
 * One headline count, and the list it counts.
 *
 * @remarks
 * A count whose list exists in this console links to it. Reading "3 organizations" and then hunting
 * the sidebar for where to see them is a step the number can take on its own.
 */
function Metric({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: number;
  readonly href?: string;
}): JSX.Element {
  const body = (
    <Stack gap={1}>
      <Text as="p" token="label-small" tone="muted">
        {label}
      </Text>
      <Text as="p" token="headline-small" numeric>
        {value.toLocaleString()}
      </Text>
    </Stack>
  );

  if (!href) return body;

  return (
    <Link href={href} className="hover:text-primary rounded-md transition-colors">
      {body}
    </Link>
  );
}

/** The shape of a retention-queue read, narrowed to what this screen needs. */
interface OrgQueueQuery {
  readonly data: { readonly items: readonly AdminOrg[] } | undefined;
  readonly isPending: boolean;
}

/**
 * A short retention queue, or nothing at all.
 *
 * @remarks
 * Renders only when it holds rows. These two queues are empty on a healthy instance, and the
 * attention band above already states that in a line — so an empty group here would be a second,
 * much larger way of reporting the same nothing, on the screen whose whole job is to say what needs
 * a person.
 */
function OrgQueue({
  title,
  query,
}: {
  readonly title: string;
  readonly query: OrgQueueQuery;
}): JSX.Element | null {
  const orgs = query.data?.items ?? [];
  if (query.isPending || orgs.length === 0) return null;

  return (
    <AdminSection title={title} body="rows">
      <AdminList label={title}>
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
    </AdminSection>
  );
}

/** A loading placeholder sized to the attention band. */
function AttentionSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-5" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-[5.5rem] w-full rounded-xl" />
      ))}
    </div>
  );
}
