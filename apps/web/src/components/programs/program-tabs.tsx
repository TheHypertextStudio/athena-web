'use client';

/**
 * An accessible, keyboard-navigable tab strip for the Program detail screen.
 *
 * @remarks
 * A thin wrapper over the shared {@link Tabs} primitive from `@docket/ui/primitives`, kept so the
 * program-detail screen keeps its own `ProgramTabItem`/`ProgramTabs` vocabulary while the actual
 * tablist treatment, WAI-ARIA behavior (roving `tabIndex`, `ArrowLeft`/`ArrowRight` wrapping,
 * `Home`/`End`, activation-follows-focus), and MD3 surface state-layers all live in one canonical
 * place. Each tab's `id` maps to the primitive's `value`, so panels stay wired via `tab-${id}` /
 * `tabpanel-${id}` exactly as before. Mirrors the project-detail tab strip so the two screens feel
 * identical.
 */
import { Tabs, type TabsItem } from '@docket/ui/primitives';
import type { JSX } from 'react';

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
  const items: readonly TabsItem[] = tabs.map((tab) => ({
    value: tab.id,
    label: tab.label,
    count: tab.count,
  }));

  return <Tabs value={value} onValueChange={onValueChange} label={label} items={items} />;
}
