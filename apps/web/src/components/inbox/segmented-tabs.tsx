'use client';

/**
 * A keyboard-navigable segmented control for the Inbox's two feeds.
 *
 * @remarks
 * The Inbox splits everything that needs a response ("Inbox") from a quieter passive
 * awareness feed ("Activity"). This renders that split as a single, pill-styled `tablist`:
 * each segment is a real `tab` with `aria-selected`, an optional count badge, and roving
 * arrow-key focus (Left/Right/Home/End) per the WAI-ARIA tabs pattern, so the control is
 * fully operable without a mouse and announces correctly to assistive tech. Selection is
 * controlled by the parent (it owns which feed is shown and the panel `id`s).
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type KeyboardEvent as ReactKeyboardEvent, useRef } from 'react';

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
  /** Resolve the DOM id of the panel a segment controls (for `aria-controls`). */
  readonly panelId: (id: TId) => string;
}

/**
 * A roving-tabindex segmented tab control.
 *
 * @example
 * ```tsx
 * <SegmentedTabs
 *   label="Inbox feeds"
 *   segments={[{ id: 'inbox', label: 'Inbox', count: 3, emphasis: true }]}
 *   value={tab}
 *   onChange={setTab}
 *   panelId={(id) => `${id}-panel`}
 * />
 * ```
 */
export function SegmentedTabs<TId extends string>({
  label,
  segments,
  value,
  onChange,
  panelId,
}: SegmentedTabsProps<TId>): JSX.Element {
  const tabRefs = useRef<Map<TId, HTMLButtonElement>>(new Map());

  /** Move selection + focus to the tab at `index` (wrapping), per the tabs pattern. */
  const focusTab = (index: number): void => {
    const count = segments.length;
    const next = segments[((index % count) + count) % count];
    if (!next) return;
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusTab(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(segments.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="bg-muted/60 inline-flex items-center gap-1 rounded-lg p-1"
    >
      {segments.map((segment, index) => {
        const selected = segment.id === value;
        const showCount = typeof segment.count === 'number' && segment.count > 0;
        return (
          <button
            key={segment.id}
            ref={(node) => {
              if (node) tabRefs.current.set(segment.id, node);
              else tabRefs.current.delete(segment.id);
            }}
            type="button"
            role="tab"
            id={`${panelId(segment.id)}-tab`}
            aria-selected={selected}
            aria-controls={panelId(segment.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(segment.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className={cn(
              'focus-visible:ring-ring focus-visible:ring-offset-background inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {segment.label}
            {showCount ? (
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                  segment.emphasis
                    ? 'bg-destructive/10 text-destructive'
                    : selected
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-background/60 text-muted-foreground',
                )}
              >
                {segment.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
