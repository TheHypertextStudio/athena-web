'use client';

import { Row, Skeleton, Stack, Text } from '@docket/ui/primitives';
import { useParams, useSearchParams } from 'next/navigation';
import { type JSX, Suspense } from 'react';

import { DetailBackLink } from '@/components/admin-detail';
import { AsyncContent, ListSkeleton, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { api } from '@/lib/api';
import {
  RESOURCE_LABEL,
  formatCost,
  formatCostFloor,
  formatQuantity,
  holderName,
} from '@/lib/cost-format';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminCostDetail, AdminCostLine } from '@/lib/types';

/** Which question the figures answer. */
type Lens = 'caused' | 'pays';

/** One holder's detail for a month under a lens. */
function detailDef(key: string, month: string, lens: Lens) {
  return apiQueryOptions(
    queryKeys.costHolder(key, month, lens),
    () => api.admin.costs.holders[':key'].$get({ param: { key }, query: { month, lens } }),
    'Could not load this cost breakdown.',
    { staleTime: STALE.standard },
  );
}

/** The UTC month an operator sees first. */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * One person's or workspace's cost, by resource, workspace and day.
 *
 * @returns the detail screen.
 */
export default function CostHolderPage(): JSX.Element {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
      <CostHolderDetail />
    </Suspense>
  );
}

/** The detail itself, which reads the month and lens the list was showing. */
function CostHolderDetail(): JSX.Element {
  const params = useParams<{ key: string }>();
  const search = useSearchParams();
  const month = search.get('month') ?? thisMonth();
  const lens: Lens = search.get('lens') === 'pays' ? 'pays' : 'caused';
  const detail = useApiQuery(detailDef(decodeURIComponent(params.key), month, lens));

  return (
    <AdminPage width="list" outline>
      <DetailBackLink href="/costs" label="costs" />
      <AdminPageHeader title={detail.data ? holderName(detail.data.holder) : 'Costs'} />

      {detail.error ? (
        <QueryErrorBanner
          error={detail.error}
          fallback="Could not load this cost breakdown."
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      <TotalsSection data={detail.data} month={month} />
      <ResourceSection data={detail.data} loading={detail.isPending} />
      <WorkspaceSection data={detail.data} />
      <DaySection data={detail.data} />
    </AdminPage>
  );
}

/** Props shared by the sections that read the loaded detail. */
interface SectionProps {
  /** The loaded detail, or `undefined` before it resolves. */
  readonly data: AdminCostDetail | undefined;
}

/** The month's cost and the all-time cost. */
function TotalsSection({ data, month }: SectionProps & { readonly month: string }): JSX.Element {
  return (
    <AdminSection title="Totals">
      {data ? (
        <Row gap={6} className="flex-wrap">
          <Total
            label={month}
            value={formatCostFloor(data.holder.costMicros, data.holder.hasUnpriced)}
          />
          <Total label="All time" value={formatCost(data.lifetimeCostMicros)} />
        </Row>
      ) : (
        <Skeleton className="h-10 w-48" />
      )}
    </AdminSection>
  );
}

/** The month by resource. */
function ResourceSection({
  data,
  loading,
}: SectionProps & { readonly loading: boolean }): JSX.Element {
  const lines = data?.lines ?? [];
  return (
    <AdminSection title="By resource" body="rows">
      <AsyncContent
        loading={loading}
        empty={lines.length === 0}
        skeleton={<ListSkeleton rows={3} />}
        emptyState={
          <Text as="p" token="body-small" tone="muted">
            No usage in this month.
          </Text>
        }
      >
        <AdminList label="Cost by resource">
          {lines.map((line) => (
            <AdminListRow
              key={`${line.resource}:${line.dimension}`}
              interactive={false}
              title={RESOURCE_LABEL[line.resource]}
              subtitle={lineSubtitle(line)}
              meta={formatQuantity(line.resource, line.quantity)}
              trailing={<Amount micros={line.costMicros} />}
            />
          ))}
        </AdminList>
      </AsyncContent>
    </AdminSection>
  );
}

/** The month by workspace. */
function WorkspaceSection({ data }: SectionProps): JSX.Element {
  return (
    <AdminSection title="By workspace" body="rows">
      <AdminList label="Cost by workspace">
        {(data?.workspaces ?? []).map((workspace) => (
          <AdminListRow
            key={workspace.organizationId ?? 'none'}
            interactive={false}
            title={workspace.name ?? 'No workspace'}
            trailing={<Amount micros={workspace.costMicros} />}
          />
        ))}
      </AdminList>
    </AdminSection>
  );
}

/** The month by day. */
function DaySection({ data }: SectionProps): JSX.Element {
  return (
    <AdminSection title="By day" body="rows">
      <AdminList label="Cost by day">
        {(data?.daily ?? []).map((day) => (
          <AdminListRow
            key={day.day}
            interactive={false}
            title={day.day}
            trailing={<Amount micros={day.costMicros} />}
          />
        ))}
      </AdminList>
    </AdminSection>
  );
}

/** A cost, or the word that says it has no price. */
function Amount({ micros }: { readonly micros: number | null }): JSX.Element {
  return (
    <Text as="span" token="body-small" numeric>
      {micros === null ? 'Unpriced' : formatCost(micros)}
    </Text>
  );
}

/** The line under a resource: the model, table or store, and any events that could not be counted. */
function lineSubtitle(line: AdminCostLine): string | undefined {
  const parts = [
    line.dimension || null,
    line.unmeasuredEvents > 0 ? `${line.unmeasuredEvents.toLocaleString()} unmeasured` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** One headline figure. */
function Total({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <Stack gap={1}>
      <Text as="p" token="label-small" tone="muted">
        {label}
      </Text>
      <Text as="p" token="headline-small" numeric>
        {value}
      </Text>
    </Stack>
  );
}
