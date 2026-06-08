'use client';

/**
 * An accessible, keyboard-navigable tab strip for the project-detail screen.
 *
 * @remarks
 * The design system has no `Tabs` primitive yet, so this is a small, screen-local
 * implementation that follows the WAI-ARIA Tabs pattern: the strip is `role="tablist"`,
 * each trigger is `role="tab"` with `aria-selected` + roving `tabIndex`, and the active
 * trigger controls a `role="tabpanel"` rendered by the caller. Arrow keys move between
 * tabs (Home/End jump to the ends), wrapping at the boundaries. All color comes from
 * semantic tokens; the active tab is marked by a `bg-primary` underline so the affordance
 * reads even without color.
 */
import { cn } from '@docket/ui';
import type { JSX, KeyboardEvent } from 'react';
import { useRef } from 'react';

/** One tab definition: its stable id, visible label, and optional trailing count badge. */
export interface TabItem {
  /** Stable tab id (also the `aria-controls`/`id` stem). */
  id: string;
  /** Visible tab label. */
  label: string;
  /** Optional count rendered as a trailing pill (e.g. open-task count). */
  count?: number;
}

/** Props for {@link ProjectTabs}. */
export interface ProjectTabsProps {
  /** The tabs to render, in order. */
  tabs: readonly TabItem[];
  /** The currently active tab id. */
  value: string;
  /** Called with the new tab id when selection changes. */
  onValueChange: (id: string) => void;
  /** Accessible label for the tablist. */
  label: string;
}

/**
 * A horizontal tab strip wired for arrow-key navigation.
 *
 * @param props - The {@link ProjectTabsProps}.
 * @returns the rendered tablist.
 */
export function ProjectTabs({ tabs, value, onValueChange, label }: ProjectTabsProps): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Move focus + selection to the tab at `index`, wrapping around the ends. */
  function focusTab(index: number): void {
    const count = tabs.length;
    const next = ((index % count) + count) % count;
    const tab = tabs[next];
    if (!tab) return;
    onValueChange(tab.id);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTab(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-outline-variant flex items-center gap-1 border-b"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`tabpanel-${tab.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onValueChange(tab.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className={cn(
              'focus-visible:ring-ring relative -mb-px flex items-center gap-2 rounded-t-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-1',
              selected
                ? 'text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-container text-on-surface-variant',
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {selected ? (
              <span
                aria-hidden="true"
                className="bg-primary absolute inset-x-0 -bottom-px h-0.5 rounded-full"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
