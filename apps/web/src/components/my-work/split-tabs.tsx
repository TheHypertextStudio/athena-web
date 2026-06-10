'use client';

import { cn } from '@docket/ui/lib/utils';
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

/**
 * A Linear-style segmented tab control for the My Work agent-aware split.
 *
 * @remarks
 * Renders an ARIA `tablist` of underline tabs ("Assigned to me" vs "Delegated …") with a
 * count badge per tab. Selection is roving-tabindex and arrow-key navigable per the WAI-ARIA
 * tabs pattern: only the active tab is in the tab order, and Left/Right (with Home/End) move
 * the selection. The active tab carries a `border-primary` underline and `text-on-surface`;
 * inactive tabs stay quiet on `text-on-surface-variant`. A tab whose `emphasis` is set tints
 * its badge with the `destructive` token so a "needs you" count (e.g. pending approvals)
 * draws the eye. All colors come from semantic design tokens — never hardcoded.
 *
 * @typeParam TValue - The union of tab value strings.
 */
export function SplitTabs<TValue extends string>({
  tabs,
  value,
  onChange,
  label,
}: SplitTabsProps<TValue>): JSX.Element {
  /** Select the tab at `index` (no-op when out of range, e.g. an empty tab set). */
  function selectAt(index: number): void {
    const target = tabs[index];
    if (target) onChange(target.value);
  }

  /** Move selection by a delta (wrapping) for Left/Right arrow navigation. */
  function moveBy(delta: number): void {
    const index = tabs.findIndex((tab) => tab.value === value);
    selectAt((index + delta + tabs.length) % tabs.length);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-outline-variant flex items-center gap-1 overflow-x-auto border-b"
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(tab.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveBy(1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveBy(-1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                selectAt(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                selectAt(tabs.length - 1);
              }
            }}
            className={cn(
              'focus-visible:ring-ring -mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2',
              'text-body font-medium transition-colors outline-none focus-visible:ring-1',
              selected
                ? 'border-primary text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface border-transparent',
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                  tab.emphasis && tab.count > 0
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-surface-container text-on-surface-variant',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
