'use client';

import { relativeTime } from '@docket/ui';
import { Row, Skeleton, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList } from '@/components/admin-table';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useLiveApiQuery } from '@/lib/query';
import type { AdminJobHealth, AdminStatus } from '@/lib/types';

import { ServiceRow } from './service-row';

/** How often the board re-reads while an operator is looking at it. */
const STATUS_POLL_MS = 30_000;

/** The service-status board. */
const statusDef = apiQueryOptions(
  queryKeys.status(),
  () => api.admin.status.$get(),
  'Could not load service status.',
  { staleTime: STALE.volatile },
);

/**
 * Whether every service and job is currently healthy, and what is running.
 *
 * @remarks
 * The board polls while it is on screen, because it is the one screen someone opens *because* they
 * suspect something is wrong, and a stale answer there is worse than none.
 *
 * @returns the status screen.
 */
export default function StatusPage(): JSX.Element {
  const status = useLiveApiQuery(statusDef, STATUS_POLL_MS);

  return (
    <AdminPage width="list" outline>
      <AdminPageHeader title="Service status" />

      {status.error ? (
        <QueryErrorBanner
          error={status.error}
          fallback="Could not load service status."
          onRetry={() => void status.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={status.isPending}
        empty={status.data === undefined}
        skeleton={<Skeleton className="h-40 w-full rounded-xl" />}
        emptyState={<Skeleton className="h-40 w-full rounded-xl" />}
      >
        {status.data ? <StatusBoard status={status.data} /> : null}
      </AsyncContent>
    </AdminPage>
  );
}

/** Every section of the board, once the read has resolved. */
function StatusBoard({ status }: { readonly status: AdminStatus }): JSX.Element {
  const platform = status.services.filter((service) => service.kind === 'platform');
  const dependencies = status.services.filter((service) => service.kind === 'dependency');

  return (
    <>
      {status.probesEnabled ? null : (
        <AdminSection title="Probing is off">
          <Text as="p" token="body-small" tone="muted">
            Scheduled checks are switched off, so everything below is as old as the last pass that
            ran. Turn them back on in Settings.
          </Text>
        </AdminSection>
      )}

      <AdminSection title="Docket services" body="rows">
        <AdminList label="Docket services">
          {platform.map((service) => (
            <ServiceRow key={service.key} service={service} />
          ))}
        </AdminList>
      </AdminSection>

      <AdminSection
        title="Dependencies"
        description="Read from the requests we actually sent, so a provider failing real work shows here even while it answers a ping."
        body="rows"
      >
        <AdminList label="Dependencies">
          {dependencies.map((service) => (
            <ServiceRow key={service.key} service={service} />
          ))}
        </AdminList>
      </AdminSection>

      <AdminSection
        title="Background work"
        description={`Failures recorded in the last ${String(status.jobWindowHours)} hours.`}
      >
        <Stack gap={2}>
          {status.jobs.map((job) => (
            <JobRow key={job.key} job={job} />
          ))}
        </Stack>
      </AdminSection>
    </>
  );
}

/** One internal ledger's recent record. */
function JobRow({ job }: { readonly job: AdminJobHealth }): JSX.Element {
  return (
    <Row gap={3} align="center" className="min-w-0">
      <Text as="span" token="body-small" truncate className="min-w-0 flex-1">
        {job.label}
      </Text>
      {job.total === 0 ? (
        <Text as="span" token="body-small" tone="muted">
          No runs
        </Text>
      ) : (
        <JobCounts job={job} />
      )}
    </Row>
  );
}

/** What a ledger with runs in the window reports. */
function JobCounts({ job }: { readonly job: AdminJobHealth }): JSX.Element {
  if (job.failures === 0) {
    return (
      <Text as="span" token="body-small" tone="muted" numeric>
        {`${String(job.total)} ok`}
      </Text>
    );
  }

  return (
    <Row gap={3} align="center" className="shrink-0">
      {job.lastFailureAt ? (
        <Text as="span" token="body-small" tone="muted">
          {relativeTime(job.lastFailureAt)}
        </Text>
      ) : null}
      <span className="bg-error-container text-on-error-container rounded-full px-2 py-0.5">
        <Text as="span" token="label-small" numeric>
          {`${String(job.failures)} of ${String(job.total)} failed`}
        </Text>
      </span>
    </Row>
  );
}
