'use client';

/**
 * An accessible, keyboard-navigable tab strip for the Program detail screen.
 *
 * @remarks
 * The design system has no `Tabs` primitive yet, so this is a small, screen-local
 * implementation that follows the WAI-ARIA Tabs pattern: the strip is `role="tablist"`,
 * each trigger is `role="tab"` with `aria-selected` + roving `tabIndex`, and the active
 * trigger controls a `role="tabpanel"` rendered by the caller. Arrow keys move between tabs
 * (Home/End jump to the ends), wrapping at the boundaries. All color comes from semantic
 * tokens; the active tab is marked by a `bg-primary` underline so the affordance reads even
 * without color. Mirrors the project-detail tab strip so the two screens feel identical.
 */
import { cn } from '@docket/ui';
import type { JSX, KeyboardEvent } from 'react';
import { useRef } from 'react';

/** One tab definition: its stable id, visible label, and optional trailing count badge. */
export interface ProgramTabItem {
  /** Stable tab id (also the `aria-controls`/`id` stem). */
  id: string;
  /** Visible tab label. */
  label: string;
  /** Optional count rendered as a trailing pill. */
  count?: number;
}

/** Props for {@link ProgramTabs}. */
export interface ProgramTabsProps {
  /** The tabs to render, in order. */
  tabs: readonly ProgramTabItem[];
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
 * @param props - The {@link ProgramTabsProps}.
 * @returns the rendered tablist.
 */
export function ProgramTabs({ tabs, value, onValueChange, label }: ProgramTabsProps): JSX.Element {
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
      className="border-border flex items-center gap-1 border-b"
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
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
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
