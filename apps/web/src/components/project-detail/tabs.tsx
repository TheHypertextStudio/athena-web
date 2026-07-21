'use client';

/**
 * An accessible, keyboard-navigable tab strip for the project-detail screen.
 *
 * @remarks
 * A thin wrapper over the shared {@link Tabs} primitive from `@docket/ui/primitives`, kept so the
 * project-detail screen keeps its own `TabItem`/`ProjectTabs` vocabulary while the actual tablist
 * treatment, WAI-ARIA behavior (roving `tabIndex`, `ArrowLeft`/`ArrowRight` wrapping, `Home`/`End`,
 * activation-follows-focus), and MD3 surface state-layers all live in one canonical place. Each
 * tab's `id` maps to the primitive's `value`, so panels stay wired via `tab-${id}` /
 * `tabpanel-${id}` exactly as before.
 */
import { Tabs, type TabsItem } from '@docket/ui/primitives';
import type { JSX } from 'react';

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
  const items: readonly TabsItem[] = tabs.map((tab) => ({
    value: tab.id,
    label: tab.label,
    count: tab.count,
  }));

  return <Tabs value={value} onValueChange={onValueChange} label={label} items={items} />;
}
