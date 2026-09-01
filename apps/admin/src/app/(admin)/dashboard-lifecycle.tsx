'use client';

import { type JSX } from 'react';

import { ProportionBar, type ProportionSegment } from '@/components/proportion-bar';
import { type LifecycleState, lifecycleLabel } from '@/lib/lifecycle';
import type { AdminMetrics } from '@/lib/types';

/** One lifecycle bucket as the metrics response reports it. */
type Bucket = AdminMetrics['orgsByLifecycle'][number];

/**
 * The fill each lifecycle state takes in the proportional bar.
 *
 * @remarks
 * A neutral ramp rather than six hues. These are stages of one pipeline, not six unrelated
 * categories, so they read as steps along a single ramp — and the two that carry operational
 * weight, `past_due` and `pending_deletion`, are the only ones that take colour.
 */
const SEGMENT_FILL: Readonly<Record<LifecycleState, string>> = {
  trialing: 'bg-primary/40',
  active: 'bg-primary',
  past_due: 'bg-error/70',
  export_window: 'bg-on-surface/20',
  pending_deletion: 'bg-error',
  deleted: 'bg-on-surface/10',
};

/** Props for {@link LifecycleDistribution}. */
export interface LifecycleDistributionProps {
  /** The per-state org counts, in fixed pipeline order. */
  readonly buckets: readonly Bucket[];
}

/**
 * Where every organization sits in the retention pipeline.
 *
 * @param props - See {@link LifecycleDistributionProps}.
 * @returns the distribution.
 */
export function LifecycleDistribution({ buckets }: LifecycleDistributionProps): JSX.Element {
  const segments: ProportionSegment[] = buckets.map((bucket) => ({
    key: bucket.lifecycleState,
    label: lifecycleLabel(bucket.lifecycleState),
    value: bucket.count,
    fill: SEGMENT_FILL[bucket.lifecycleState],
  }));

  return <ProportionBar segments={segments} emptyLabel="No organizations yet." />;
}
