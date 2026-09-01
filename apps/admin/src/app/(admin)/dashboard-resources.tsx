'use client';

import { Row, Skeleton, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { ProportionBar, type ProportionSegment } from '@/components/proportion-bar';
import { formatBytes } from '@docket/ui';
import type { AdminResources } from '@/lib/types';

/** What each store is called, and the fill it takes in the bar. */
const STORES: Readonly<Record<string, { readonly label: string; readonly fill: string }>> = {
  attachment: { label: 'Attachments', fill: 'bg-primary' },
  document_image: { label: 'Document images', fill: 'bg-primary/50' },
  discount_evidence: { label: 'Discount evidence', fill: 'bg-on-surface/25' },
};

/** Props for {@link ResourceUsage}. */
export interface ResourceUsageProps {
  /** The resource report, or `undefined` before it resolves. */
  readonly resources: AdminResources | undefined;
}

/**
 * What the deployment is consuming: stored bytes by store, and the database.
 *
 * @remarks
 * Storage is a distribution rather than a single total, because "we hold 4 GB" does not tell an
 * operator anything they can act on and "3.9 GB of that is document images" does.
 *
 * The database figure is reported beside it rather than in the same bar. They are measured in the
 * same unit but live in different places and grow for different reasons, so summing them into one
 * total would invent a number that means nothing.
 *
 * @param props - See {@link ResourceUsageProps}.
 * @returns the resource panel.
 */
export function ResourceUsage({ resources }: ResourceUsageProps): JSX.Element {
  if (!resources) return <Skeleton className="h-20 w-full rounded-lg" />;

  const segments: ProportionSegment[] = resources.storage.map((store): ProportionSegment => ({
    key: store.store,
    label: STORES[store.store]?.label ?? store.store,
    value: store.byteSize,
    fill: STORES[store.store]?.fill ?? 'bg-on-surface/20',
    display: formatBytes(store.byteSize),
  }));

  return (
    <Stack gap={4}>
      <Row gap={6} className="flex-wrap">
        <Total label="Stored objects" value={formatBytes(resources.storageByteSize)} />
        <Total label="Database" value={formatBytes(resources.databaseByteSize)} />
      </Row>
      <ProportionBar segments={segments} emptyLabel="Nothing stored yet." />
    </Stack>
  );
}

/** One headline size. */
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
