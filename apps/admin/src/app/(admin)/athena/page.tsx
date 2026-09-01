'use client';

import { Row, Skeleton, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { ProportionBar, type ProportionSegment } from '@/components/proportion-bar';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminAthenaUsage, AdminUsageSlice } from '@/lib/types';

/** What Athena ran, and what it cost. */
const athenaUsageDef = apiQueryOptions(
  queryKeys.athenaUsage(),
  () => api.admin['athena-usage'].$get(),
  'Could not load Athena usage.',
  { staleTime: STALE.static },
);

/** The fills the token bar uses, in the order the segments read. */
const TOKEN_FILL = ['bg-primary', 'bg-primary/50', 'bg-on-surface/25', 'bg-on-surface/15'] as const;

/** What each execution surface is called on screen. */
const SURFACE_LABEL: Readonly<Record<string, string>> = {
  docket: "Docket's own compute",
  lattice: 'A personal Lattice runtime',
  unknown: 'Unattributed',
};

/** What each session kind is called on screen. */
const KIND_LABEL: Readonly<Record<string, string>> = {
  chat: 'Conversations',
  job: 'Background jobs',
  unknown: 'Unattributed',
};

/**
 * What Athena is doing, and what it costs.
 *
 * @remarks
 * Nothing recorded token spend before this screen existed — the schema said so in as many words —
 * so the question "what is Athena costing" had no answer anywhere in the product.
 *
 * Every total is reported against how many generations were actually measured. Work executed on a
 * person's own runtime returns no counts, because the compute is theirs and its provider is not
 * ours to ask, so a token figure alone cannot tell light use apart from work this deployment simply
 * cannot see.
 *
 * @returns the usage screen.
 */
export default function AthenaUsagePage(): JSX.Element {
  const usage = useApiQuery(athenaUsageDef);

  return (
    <AdminPage width="list" outline>
      <AdminPageHeader title="Athena usage" />

      {usage.error ? (
        <QueryErrorBanner
          error={usage.error}
          fallback="Could not load Athena usage."
          onRetry={() => void usage.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={usage.isPending}
        empty={usage.data === undefined}
        skeleton={<Skeleton className="h-40 w-full rounded-xl" />}
        emptyState={<Skeleton className="h-40 w-full rounded-xl" />}
      >
        {usage.data ? <UsageReport usage={usage.data} /> : null}
      </AsyncContent>
    </AdminPage>
  );
}

/** Every section of the report, once the read has resolved. */
function UsageReport({ usage }: { readonly usage: AdminAthenaUsage }): JSX.Element {
  const days = Math.round(usage.windowHours / 24);
  const unmeasured = usage.runs - usage.measuredRuns;

  return (
    <>
      <AdminSection title="Tokens" description={`Across the last ${String(days)} days.`}>
        <Stack gap={4}>
          <Row gap={6} className="flex-wrap">
            <Total label="Input" value={usage.tokens.inputTokens} />
            <Total label="Output" value={usage.tokens.outputTokens} />
            <Total label="Cache reads" value={usage.tokens.cacheReadTokens} />
            <Total label="Cache writes" value={usage.tokens.cacheCreationTokens} />
          </Row>
          <ProportionBar
            segments={tokenSegments(usage)}
            emptyLabel="No measured generations in this window."
          />
        </Stack>
      </AdminSection>

      <AdminSection title="Generations">
        <Row gap={6} className="flex-wrap">
          <Total label="Total" value={usage.runs} />
          <Total label="Measured" value={usage.measuredRuns} />
          <Total label="Failed" value={usage.failedRuns} />
        </Row>
        {unmeasured > 0 ? (
          <Text as="p" token="body-small" tone="muted">
            {`${unmeasured.toLocaleString()} ran where the token cost is not visible to this deployment, so the totals above cover ${usage.measuredRuns.toLocaleString()} of ${usage.runs.toLocaleString()}.`}
          </Text>
        ) : null}
      </AdminSection>

      <AdminSection title="By model">
        <SliceList slices={usage.byModel} />
      </AdminSection>

      <AdminSection title="Where it ran">
        <SliceList slices={usage.bySurface} label={(key) => SURFACE_LABEL[key] ?? key} />
      </AdminSection>

      <AdminSection title="What kind of work">
        <SliceList slices={usage.byKind} label={(key) => KIND_LABEL[key] ?? key} />
      </AdminSection>
    </>
  );
}

/** The four token kinds as one distribution. */
function tokenSegments(usage: AdminAthenaUsage): ProportionSegment[] {
  const kinds = [
    { key: 'input', label: 'Input', value: usage.tokens.inputTokens },
    { key: 'output', label: 'Output', value: usage.tokens.outputTokens },
    { key: 'cache-read', label: 'Cache reads', value: usage.tokens.cacheReadTokens },
    { key: 'cache-write', label: 'Cache writes', value: usage.tokens.cacheCreationTokens },
  ];
  return kinds.map((kind, index) => ({
    ...kind,
    fill: TOKEN_FILL[index] ?? 'bg-on-surface/20',
    display: kind.value.toLocaleString(),
  }));
}

/** One grouped dimension, as rows of runs and their token cost. */
function SliceList({
  slices,
  label,
}: {
  readonly slices: readonly AdminUsageSlice[];
  readonly label?: ((key: string) => string) | undefined;
}): JSX.Element {
  if (slices.length === 0) {
    return (
      <Text as="p" token="body-small" tone="muted">
        Nothing ran in this window.
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      {slices.map((slice) => (
        <Row key={slice.key} gap={3} align="center" className="min-w-0">
          <Text as="span" token="body-small" truncate className="min-w-0 flex-1">
            {label ? label(slice.key) : slice.key}
          </Text>
          <Text as="span" token="body-small" tone="muted" numeric className="shrink-0">
            {sliceSummary(slice)}
          </Text>
        </Row>
      ))}
    </Stack>
  );
}

/**
 * Summarize one slice in a line.
 *
 * @remarks
 * A slice with nothing measured says so rather than showing a zero, which would read as work that
 * cost nothing rather than work whose cost is unknown.
 *
 * @param slice - The slice to describe.
 * @returns the run count, and the token cost when there is one to report.
 */
function sliceSummary(slice: AdminUsageSlice): string {
  const runs = `${slice.runs.toLocaleString()} run${slice.runs === 1 ? '' : 's'}`;
  if (slice.measuredRuns === 0) return `${runs} · not measured`;
  const tokens = slice.tokens.inputTokens + slice.tokens.outputTokens;
  return `${runs} · ${tokens.toLocaleString()} tokens`;
}

/** One headline count. */
function Total({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return (
    <Stack gap={1}>
      <Text as="p" token="label-small" tone="muted">
        {label}
      </Text>
      <Text as="p" token="headline-small" numeric>
        {value.toLocaleString()}
      </Text>
    </Stack>
  );
}
