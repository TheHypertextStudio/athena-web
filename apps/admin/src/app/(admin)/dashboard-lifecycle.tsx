'use client';

import { Row, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

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
 * @remarks
 * Six counters in a grid made this look like six unrelated facts. It is one distribution: the
 * question an operator has is what *share* of the estate is in each stage, and a proportional bar
 * answers that before any number is read. The counts stay beneath it, because a share without a
 * magnitude is not actionable.
 *
 * States holding no organizations are dropped from the legend rather than listed as zeroes — six
 * rows of "0" is the noise this replaced.
 *
 * @param props - See {@link LifecycleDistributionProps}.
 * @returns the distribution.
 */
export function LifecycleDistribution({ buckets }: LifecycleDistributionProps): JSX.Element {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const occupied = buckets.filter((bucket) => bucket.count > 0);

  if (total === 0) {
    return (
      <Text as="p" token="body-small" tone="muted">
        No organizations yet.
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      <div
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={occupied
          .map((bucket) => `${lifecycleLabel(bucket.lifecycleState)}: ${String(bucket.count)}`)
          .join(', ')}
      >
        {occupied.map((bucket) => (
          <span
            key={bucket.lifecycleState}
            className={SEGMENT_FILL[bucket.lifecycleState]}
            style={{ width: `${String((bucket.count / total) * 100)}%` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 @xl:grid-cols-3">
        {occupied.map((bucket) => (
          <Row key={bucket.lifecycleState} gap={2} align="center" className="min-w-0">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${SEGMENT_FILL[bucket.lifecycleState]}`}
            />
            <Text as="span" token="body-small" tone="muted" truncate className="min-w-0 flex-1">
              {lifecycleLabel(bucket.lifecycleState)}
            </Text>
            <Text as="span" token="body-small" numeric>
              {bucket.count.toLocaleString()}
            </Text>
          </Row>
        ))}
      </div>
    </Stack>
  );
}
