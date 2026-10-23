'use client';
import { Tabs } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** A single tab in a {@link SplitTabs} control. */
export interface SplitTab<TValue extends string> {
  /** The tab's stable value (returned by `onChange`). */
  value: TValue;
  /** The tab's visible label. */
  label: string;
  /** Optional count badge shown after the label. */
  count?: number;
  /** Whether the count badge should read as needing attention (escalated tint). */
  emphasis?: boolean;
}

/** Props for {@link SplitTabs}. */
export interface SplitTabsProps<TValue extends string> {
  /** The tabs to render, in order. */
  tabs: readonly SplitTab<TValue>[];
  /** The currently selected tab value. */
  value: TValue;
  /** Select a tab. */
  onChange: (value: TValue) => void;
  /** Accessible label for the tablist. */
  label: string;
}

/** Peer collections for the person and their delegated work. */
export function SplitTabs<TValue extends string>({
  tabs,
  value,
  onChange,
  label,
}: SplitTabsProps<TValue>): JSX.Element {
  return (
    <Tabs
      label={label}
      value={value}
      onValueChange={(next) => {
        onChange(next as TValue);
      }}
      items={tabs.map((tab) => ({
        value: tab.value,
        label: tab.label,
        ...(tab.emphasis ? { emphasis: true } : {}),
        ...(tab.count === undefined ? {} : { count: tab.count }),
      }))}
    />
  );
}
