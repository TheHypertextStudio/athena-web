'use client';

import { cn } from '@docket/ui/lib/utils';
import { Badge, Tab, TabList, Tabs } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The count badge's tone on the selected tab, one tonal step off the resting badge. */
const SELECTED_COUNT_TONE = 'bg-surface-container text-on-surface';

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

/**
 * The My Work agent-aware split, built on the shared {@link Tabs} primitive.
 *
 * @remarks
 * Renders the canonical Docket tablist ("Assigned to me" vs "Delegated …") so the control reads
 * as clickable: a resting `bg-surface-container` track, an inactive tab that tones up on hover
 * via the MD3 surface state-layer, and a selected tab that fills to `bg-surface-container-highest`.
 * Keyboard behavior (roving tabindex, Left/Right wrapping, Home/End, activation-follows-focus) and
 * the `role="tab"` / `aria-selected` / `aria-controls={`tabpanel-${value}`}` wiring come from the
 * primitive; the matching `role="tabpanel"` stays owned by the caller.
 *
 * Each tab keeps its count badge. Because the shared count pill has a single tint, the badge is
 * rendered here in the tab's content so a tab whose `emphasis` is set (e.g. pending approvals) can
 * escalate to the `destructive` token while quiet tabs track the primitive's selected-aware surface
 * tint. All colors come from semantic design tokens — never hardcoded.
 *
 * @typeParam TValue - The union of tab value strings.
 */
export function SplitTabs<TValue extends string>({
  tabs,
  value,
  onChange,
  label,
}: SplitTabsProps<TValue>): JSX.Element {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        onChange(next as TValue);
      }}
    >
      <TabList label={label} className="max-w-full overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.value === value;
          const showCount = tab.count !== undefined;
          const emphatic = tab.emphasis === true && (tab.count ?? 0) > 0;
          return (
            <Tab key={tab.value} value={tab.value}>
              <span className="inline-flex items-center gap-2">
                {tab.label}
                {showCount ? (
                  <Badge
                    variant={emphatic ? 'destructive' : 'secondary'}
                    className={cn('min-w-5', selected && !emphatic && SELECTED_COUNT_TONE)}
                  >
                    {tab.count}
                  </Badge>
                ) : null}
              </span>
            </Tab>
          );
        })}
      </TabList>
    </Tabs>
  );
}
