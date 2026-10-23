'use client';
import { Tabs } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** One segment in the {@link SegmentedTabs} control. */
export interface SegmentDef<TId extends string> {
  /** Stable segment id (matches the controlled `value`). */
  readonly id: TId;
  /** The segment's visible label. */
  readonly label: string;
  /** An optional count badge (omitted when `undefined` or `0`). */
  readonly count?: number;
  /** When `true`, the count badge reads as an alert (the actionable queue). */
  readonly emphasis?: boolean;
}

/** Props for {@link SegmentedTabs}. */
export interface SegmentedTabsProps<TId extends string> {
  /** An accessible label for the whole control (e.g. "Inbox feeds"). */
  readonly label: string;
  /** The segments to render, in display order. */
  readonly segments: readonly SegmentDef<TId>[];
  /** The currently selected segment id. */
  readonly value: TId;
  /** Select a segment. */
  readonly onChange: (id: TId) => void;
}

/** Content categories in the Inbox; all remain reachable in the scrollable lane. */
export function SegmentedTabs<TId extends string>({
  label,
  segments,
  value,
  onChange,
}: SegmentedTabsProps<TId>): JSX.Element {
  return (
    <Tabs
      label={label}
      value={value}
      onValueChange={(next) => {
        onChange(next as TId);
      }}
      items={segments.map((segment) => ({
        value: segment.id,
        label: segment.label,
        ...(segment.emphasis ? { emphasis: true } : {}),
        ...(segment.count ? { count: segment.count } : {}),
      }))}
    />
  );
}
