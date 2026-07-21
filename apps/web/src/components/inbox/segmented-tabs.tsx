'use client';

/**
 * The Inbox's two-feed switcher, built on the shared {@link Tabs} primitive.
 *
 * @remarks
 * The Inbox splits everything that needs a response ("Inbox") from a quieter passive awareness feed
 * ("Activity"). This renders that split as the canonical Docket tablist so the control reads as
 * clickable: a resting `bg-surface-container` track, an inactive segment that tones up on hover via
 * the MD3 surface state-layer, and a selected segment that fills to `bg-surface-container-highest`.
 * Keyboard behavior (roving tabindex, Left/Right wrapping, Home/End, activation-follows-focus) and
 * the `role="tab"` / `aria-selected` / `aria-controls={`tabpanel-${id}`}` wiring come from the
 * primitive; the caller renders the matching `role="tabpanel"` and owns which feed is shown.
 *
 * Each segment keeps its count badge. Because the shared count pill has a single tint, the badge is
 * rendered here in the segment's content so the actionable queue (`emphasis`) can escalate to the
 * `destructive` token while quiet segments track the primitive's selected-aware surface tint.
 */
import { cn } from '@docket/ui/lib/utils';
import { Tab, TabList, Tabs } from '@docket/ui/primitives';
import { type JSX } from 'react';

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
  /**
   * Retained for caller compatibility. The shared {@link Tabs} primitive now owns the tab/panel ids
   * (`tab-${id}` / `tabpanel-${id}`), so callers should label their `role="tabpanel"` with those.
   */
  readonly panelId?: (id: TId) => string;
}

/**
 * A roving-tabindex tab control for the Inbox feeds.
 *
 * @example
 * ```tsx
 * <SegmentedTabs
 *   label="Inbox feeds"
 *   segments={[{ id: 'inbox', label: 'Inbox', count: 3, emphasis: true }]}
 *   value={tab}
 *   onChange={setTab}
 * />
 * <div role="tabpanel" id="tabpanel-inbox" aria-labelledby="tab-inbox">…</div>
 * ```
 */
export function SegmentedTabs<TId extends string>({
  label,
  segments,
  value,
  onChange,
}: SegmentedTabsProps<TId>): JSX.Element {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        onChange(next as TId);
      }}
    >
      <TabList label={label} className="max-w-full overflow-x-auto">
        {segments.map((segment) => {
          const selected = segment.id === value;
          const showCount = typeof segment.count === 'number' && segment.count > 0;
          return (
            <Tab key={segment.id} value={segment.id}>
              <span className="inline-flex items-center gap-2">
                {segment.label}
                {showCount ? (
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                      segment.emphasis
                        ? 'bg-destructive/10 text-destructive'
                        : selected
                          ? 'bg-surface-container text-on-surface'
                          : 'bg-surface-container-high text-on-surface-variant',
                    )}
                  >
                    {segment.count}
                  </span>
                ) : null}
              </span>
            </Tab>
          );
        })}
      </TabList>
    </Tabs>
  );
}
