'use client';

/**
 * `settings` — the top-level tab strip for the per-org Settings screen.
 *
 * @remarks
 * The design system has no `Tabs` primitive, so this is a small, screen-local control that
 * follows the WAI-ARIA Tabs pattern (mirroring the project-detail / my-work tab strips for a
 * cohesive feel): the strip is `role="tablist"`, each trigger is `role="tab"` with
 * `aria-selected` + roving `tabIndex`, and the active trigger controls a `role="tabpanel"`
 * rendered by the caller. Arrow keys move between tabs (Home/End jump to the ends), wrapping
 * at the boundaries. Each tab carries a leading icon so the affordance reads beyond color,
 * and the active tab is marked with a `bg-primary` underline. All color comes from semantic
 * tokens.
 */
import type { LucideIcon } from '@docket/ui/icons';
import { cn } from '@docket/ui';
import type { JSX, KeyboardEvent } from 'react';
import { useRef } from 'react';

/** One settings tab: its stable id, visible label, and leading glyph. */
export interface SettingsTab<TValue extends string> {
  /** Stable tab id (also the `aria-controls`/`id` stem). */
  value: TValue;
  /** Visible tab label. */
  label: string;
  /** Leading glyph rendered before the label. */
  icon: LucideIcon;
}

/** Props for {@link SettingsTabs}. */
export interface SettingsTabsProps<TValue extends string> {
  /** The tabs to render, in order. */
  tabs: readonly SettingsTab<TValue>[];
  /** The currently selected tab value. */
  value: TValue;
  /** Select a tab. */
  onChange: (value: TValue) => void;
  /** Accessible label for the tablist. */
  label: string;
}

/**
 * A horizontal, keyboard-navigable tab strip for the Settings sub-areas.
 *
 * @param props - The {@link SettingsTabsProps}.
 * @returns the rendered tablist.
 *
 * @typeParam TValue - The union of tab value strings.
 */
export function SettingsTabs<TValue extends string>({
  tabs,
  value,
  onChange,
  label,
}: SettingsTabsProps<TValue>): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Move focus + selection to the tab at `index`, wrapping around the ends. */
  function focusTab(index: number): void {
    const count = tabs.length;
    const next = ((index % count) + count) % count;
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
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
        const selected = tab.value === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.value}`}
            aria-controls={`settings-tabpanel-${tab.value}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(tab.value);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className={cn(
              'focus-visible:ring-ring relative -mb-px flex items-center gap-2 rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-1',
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{tab.label}</span>
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
