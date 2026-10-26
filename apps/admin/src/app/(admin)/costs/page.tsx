'use client';

import { IdentityGlyph } from '@docket/ui/components';
import { Building, Gauge, User } from '@docket/ui/icons';
import { Badge, Button, Input, Row, Skeleton, Stack, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { AsyncContent, ListSkeleton, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { api } from '@/lib/api';
import { RESOURCE_LABEL, formatCostFloor, holderName } from '@/lib/cost-format';
import { formatTimestamp } from '@/lib/lifecycle';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminCostHolder, AdminCosts } from '@/lib/types';
import { RatesSection } from './rates-section';

/** Which question the ranking answers. */
type Lens = AdminCosts['lens'];

/** The two lenses, in the order the toggle reads. */
const LENSES: readonly { readonly value: Lens; readonly label: string }[] = [
  { value: 'caused', label: 'Caused by' },
  { value: 'pays', label: 'Paid by' },
];

/** What each ledger pass is called. */
const METER_LABEL: Readonly<Record<AdminCosts['meters'][number]['meter'], string>> = {
  ai_tokens: 'AI tokens',
  postgres_storage: 'Database storage',
  object_storage: 'File storage',
};

/** The UTC month an operator sees first. */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** The ranked report for one month under one lens. */
function reportDef(month: string, lens: Lens) {
  return apiQueryOptions(
    queryKeys.costReport(month, lens),
    () => api.admin.costs.$get({ query: { month, lens } }),
    'Could not load costs.',
    { staleTime: STALE.standard },
  );
}

/**
 * What each person and workspace costs, ranked, and the prices behind it.
 *
 * @remarks
 * Costs are computed from recorded usage and the price list at the time the screen is read, so a
 * changed price changes every figure here. A figure that carries a plus sign had usage with no price
 * and is a minimum, not the whole cost.
 *
 * @returns the costs screen.
 */
export default function CostsPage(): JSX.Element {
  const [month, setMonth] = useState(thisMonth);
  const [lens, setLens] = useState<Lens>('caused');
  const report = useApiQuery(reportDef(month, lens));
  const holders = report.data?.holders ?? [];

  return (
    <AdminPage width="list" outline>
      <AdminPageHeader
        title="Costs"
        actions={
          <Row gap={2} align="center">
            {LENSES.map((option) => (
              <Button
                key={option.value}
                variant={option.value === lens ? 'secondary' : 'ghost'}
                controlSize="sm"
                aria-pressed={option.value === lens}
                onClick={() => {
                  setLens(option.value);
                }}
              >
                {option.label}
              </Button>
            ))}
            <Input
              type="month"
              aria-label="Month"
              value={month}
              onChange={(event) => {
                if (event.target.value) setMonth(event.target.value);
              }}
            />
          </Row>
        }
      />

      {report.error ? (
        <QueryErrorBanner
          error={report.error}
          fallback="Could not load costs."
          onRetry={() => void report.refetch()}
        />
      ) : null}

      <AdminSection title="Total">
        {report.data ? <TotalLine report={report.data} /> : <Skeleton className="h-10 w-48" />}
      </AdminSection>

      <AdminSection title="People and workspaces" body="rows">
        <AsyncContent
          loading={report.isPending}
          empty={holders.length === 0}
          skeleton={<ListSkeleton rows={4} />}
          emptyState={
            <Text as="p" token="body-small" tone="muted">
              No usage recorded in this month.
            </Text>
          }
        >
          <AdminList label="Cost by holder">
            {holders.map((holder) => (
              <AdminListRow
                key={holder.key}
                href={`/costs/${encodeURIComponent(holder.key)}?month=${month}&lens=${lens}`}
                leading={<HolderGlyph holder={holder} />}
                title={holderName(holder)}
                subtitle={holderSubtitle(holder)}
                meta={formatCostFloor(holder.costMicros, holder.hasUnpriced)}
                trailing={
                  holder.unmeasuredEvents > 0 ? (
                    <Badge variant="outline">{`${holder.unmeasuredEvents.toLocaleString()} unmeasured`}</Badge>
                  ) : null
                }
              />
            ))}
          </AdminList>
        </AsyncContent>
      </AdminSection>

      <RatesSection />
    </AdminPage>
  );
}

/** The month's total, and any ledger pass that is behind. */
function TotalLine({ report }: { readonly report: AdminCosts }): JSX.Element {
  const behind = report.meters.filter((meter) => meter.stale || meter.failed);
  return (
    <Stack gap={3}>
      <Text as="p" token="headline-small" numeric>
        {formatCostFloor(report.totalCostMicros, report.hasUnpriced)}
      </Text>
      {behind.length > 0 ? (
        <Stack gap={1}>
          {behind.map((meter) => (
            <Text key={meter.meter} as="p" token="body-small" tone="muted" role="status">
              {`${METER_LABEL[meter.meter]} · ${
                meter.lastSuccessAt
                  ? `last updated ${formatTimestamp(meter.lastSuccessAt)}`
                  : 'never run'
              }${meter.failed ? ' · latest run failed' : ''}`}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

/** The line under a holder's name: their email, and what costs them most. */
function holderSubtitle(holder: AdminCostHolder): string | undefined {
  const parts = [
    holder.kind === 'user' && holder.name ? holder.email : null,
    holder.kind === 'workspace' ? 'Workspace' : null,
    holder.topResource ? RESOURCE_LABEL[holder.topResource] : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The glyph each kind of holder is drawn with. */
const HOLDER_ICON = { user: User, workspace: Building, unattributed: Gauge } as const;

/** The glyph for a holder's kind. */
function HolderGlyph({ holder }: { readonly holder: AdminCostHolder }): JSX.Element {
  const Icon = HOLDER_ICON[holder.kind];
  return (
    <IdentityGlyph size={20}>
      <Icon className="size-3" />
    </IdentityGlyph>
  );
}
