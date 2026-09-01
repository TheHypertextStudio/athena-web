'use client';

import { Row, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

/** One share of the whole. */
export interface ProportionSegment {
  /** Stable identity for the segment. */
  readonly key: string;
  /** What the segment is called in the legend. */
  readonly label: string;
  /** The magnitude this segment contributes. Segments at zero are dropped. */
  readonly value: number;
  /** The token utility filling this segment's span and its legend swatch. */
  readonly fill: string;
  /** How the value reads in the legend. Defaults to the number itself. */
  readonly display?: string | undefined;
}

/** Props for {@link ProportionBar}. */
export interface ProportionBarProps {
  /** The segments, in the order they should read. */
  readonly segments: readonly ProportionSegment[];
  /** What to say when every segment is zero. */
  readonly emptyLabel: string;
}

/**
 * A distribution as one bar and a legend.
 *
 * @remarks
 * The question behind a set of related counts is usually what *share* each one holds, and a bar
 * answers that before any number is read — which a row of counters cannot do at all. The magnitudes
 * stay in the legend beneath it, because a share without one is not actionable.
 *
 * Segments at zero are dropped rather than listed, since a legend of zeroes is the noise this
 * replaces. When every segment is zero the whole thing collapses to one line.
 *
 * `packages/ui` has no chart primitive by design, so this is the console's one charting recipe:
 * a token-filled track with a composed `aria-label`, shared by every distribution rather than
 * re-derived per screen.
 *
 * @param props - See {@link ProportionBarProps}.
 * @returns the bar and its legend.
 */
export function ProportionBar({ segments, emptyLabel }: ProportionBarProps): JSX.Element {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const occupied = segments.filter((segment) => segment.value > 0);

  if (total === 0) {
    return (
      <Text as="p" token="body-small" tone="muted">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      <div
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={occupied
          .map((segment) => `${segment.label}: ${segment.display ?? String(segment.value)}`)
          .join(', ')}
      >
        {occupied.map((segment) => (
          <span
            key={segment.key}
            className={segment.fill}
            style={{ width: `${String((segment.value / total) * 100)}%` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 @xl:grid-cols-3">
        {occupied.map((segment) => (
          <Row key={segment.key} gap={2} align="center" className="min-w-0">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${segment.fill}`} />
            <Text as="span" token="body-small" tone="muted" truncate className="min-w-0 flex-1">
              {segment.label}
            </Text>
            <Text as="span" token="body-small" numeric>
              {segment.display ?? segment.value.toLocaleString()}
            </Text>
          </Row>
        ))}
      </div>
    </Stack>
  );
}
