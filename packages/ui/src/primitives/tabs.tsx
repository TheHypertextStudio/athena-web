'use client';

/**
 * `@docket/ui` — Tabs primitive (the canonical, accessible tablist treatment).
 *
 * @remarks
 * The single shared tab bar for Docket. Before this primitive the app carried five hand-rolled
 * tab strips (project detail, program detail, and friends) that each re-implemented the WAI-ARIA
 * Tabs pattern with a slightly different look; this consolidates them behind one component with
 * one visual treatment.
 *
 * Accessibility follows the WAI-ARIA Tabs pattern with a manual (roving-tabindex) tablist:
 * the container is `role="tablist"`, each {@link Tab} is `role="tab"` with `aria-selected` and a
 * roving `tabIndex` (only the selected tab is in the Tab sequence), and each tab points at its
 * caller-rendered panel via `aria-controls={`tabpanel-${value}`}` / `id={`tab-${value}`}`.
 * `ArrowLeft`/`ArrowRight` move between tabs (wrapping at the ends) and `Home`/`End` jump to the
 * first/last; activation follows focus, so arrowing also selects. Only the tablist lives here —
 * the matching `role="tabpanel"` is rendered by the caller so panels stay owned by the screen.
 *
 * Visual treatment (mirrors the agenda view-switcher track + the settings section-nav active row):
 * a resting `bg-surface-container` track with an inactive tab that tones up on hover and a
 * selected tab that fills to `bg-surface-container-highest`. Colors come from the semantic MD3
 * surface tokens in `@docket/ui/styles/globals.css`.
 *
 * Two ergonomics are supported so migration off the hand-rolled bars is clean:
 *
 * - **Data-driven** (matches every existing hand-rolled bar): pass `items` + `label` to
 *   {@link Tabs} and it renders the whole tablist.
 * - **Composable**: render {@link TabList} / {@link Tab} children yourself for custom content.
 *
 * @example
 * ```tsx
 * // Data-driven — the clean drop-in for the old hand-rolled strips.
 * <Tabs
 *   value={active}
 *   onValueChange={setActive}
 *   label="Project sections"
 *   items={[
 *     { value: 'overview', label: 'Overview' },
 *     { value: 'tasks', label: 'Tasks', count: 4 },
 *   ]}
 * />
 * <div role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">…</div>
 *
 * // Composable — full control over each tab's content.
 * <Tabs value={active} onValueChange={setActive}>
 *   <TabList label="Project sections">
 *     <Tab value="overview">Overview</Tab>
 *     <Tab value="tasks" count={4}>Tasks</Tab>
 *   </TabList>
 * </Tabs>
 * ```
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/** The shared selection state threaded from {@link Tabs} down to each {@link Tab}. */
interface TabsContextValue {
  /** The currently selected tab value. */
  readonly value: string;
  /** Select a tab by value. */
  readonly onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

/**
 * Read the enclosing {@link Tabs} selection context.
 *
 * @returns the active {@link TabsContextValue}.
 * @throws {Error} When rendered outside a {@link Tabs} root.
 */
function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs.* subcomponents must be rendered within a <Tabs> root.');
  }
  return context;
}

/** One data-driven tab definition for {@link Tabs.items}. */
export interface TabsItem {
  /** Stable tab value (also the `aria-controls`/`id` stem). */
  readonly value: string;
  /** Visible tab label. */
  readonly label: React.ReactNode;
  /** Optional count rendered as a trailing pill (e.g. an open-task count). */
  readonly count?: number;
  /** When `true`, the tab is present but not selectable. */
  readonly disabled?: boolean;
}

/** Props for {@link Tabs}. */
export interface TabsProps {
  /** The currently selected tab value (controlled). */
  readonly value: string;
  /** Called with the new tab value when the selection changes. */
  readonly onValueChange: (value: string) => void;
  /**
   * Accessible label for the tablist. Required in data-driven mode; in composable mode pass it to
   * {@link TabList} instead.
   */
  readonly label?: string;
  /**
   * Data-driven tabs. When provided, {@link Tabs} renders the whole {@link TabList} for you; omit
   * it and render {@link TabList}/{@link Tab} children yourself for the composable API.
   */
  readonly items?: readonly TabsItem[];
  /** Composable children ({@link TabList} → {@link Tab}); ignored when `items` is provided. */
  readonly children?: React.ReactNode;
  /** Extra classes for the tablist track. Applied to the auto-rendered {@link TabList} in items mode. */
  readonly className?: string;
}

/**
 * The Tabs root: provides selection context and, in data-driven mode, renders the full tablist.
 *
 * @param props - The {@link TabsProps}.
 * @returns the rendered tabs (data-driven) or the provided composable children.
 */
export function Tabs({
  value,
  onValueChange,
  label,
  items,
  children,
  className,
}: TabsProps): React.JSX.Element {
  const context = React.useMemo<TabsContextValue>(
    () => ({ value, onValueChange }),
    [value, onValueChange],
  );

  return (
    <TabsContext.Provider value={context}>
      {items ? (
        <TabList label={label} className={className}>
          {items.map((item) => (
            <Tab key={item.value} value={item.value} count={item.count} disabled={item.disabled}>
              {item.label}
            </Tab>
          ))}
        </TabList>
      ) : (
        children
      )}
    </TabsContext.Provider>
  );
}

/** Props for {@link TabList}. */
export interface TabListProps {
  /** Accessible label for the tablist (announced with the tab role). */
  readonly label?: string;
  /** Extra classes merged onto the resting track. */
  readonly className?: string;
  /** The {@link Tab} children. */
  readonly children?: React.ReactNode;
}

/** The set of keys the tablist handles for roving-tabindex navigation. */
const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End']);

/**
 * The tablist track that lays out its {@link Tab} children and wires arrow-key navigation.
 *
 * @remarks
 * Keyboard movement resolves the tab order from the DOM (`[role="tab"]`) so it stays correct for
 * any children/order without a registration step; activation follows focus.
 *
 * @param props - The {@link TabListProps}.
 * @returns the rendered `role="tablist"` track.
 */
export function TabList({ label, className, children }: TabListProps): React.JSX.Element {
  const { onValueChange } = useTabsContext();
  const ref = React.useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!NAV_KEYS.has(event.key)) return;
    const list = ref.current;
    if (!list) return;

    const tabs = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (tabs.length === 0) return;

    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex =
          currentIndex < 0 ? tabs.length - 1 : (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      default:
        nextIndex = tabs.length - 1;
        break;
    }

    const next = tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus();
    // Activation follows focus: select the newly focused tab.
    const nextValue = next.dataset['value'];
    if (nextValue !== undefined) onValueChange(nextValue);
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'bg-surface-container inline-flex items-center gap-0.5 rounded-lg p-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Props for {@link Tab}. */
export interface TabProps {
  /** Stable tab value (also the `aria-controls`/`id` stem). */
  readonly value: string;
  /** Optional count rendered as a trailing pill. */
  readonly count?: number;
  /** When `true`, the tab is present but not selectable. */
  readonly disabled?: boolean;
  /** Extra classes merged onto the tab button. */
  readonly className?: string;
  /** The visible tab label. */
  readonly children?: React.ReactNode;
}

/**
 * A single tab trigger with the standard resting/hover/selected treatment.
 *
 * @param props - The {@link TabProps}.
 * @returns the rendered `role="tab"` button.
 */
export function Tab({ value, count, disabled, className, children }: TabProps): React.JSX.Element {
  const { value: selectedValue, onValueChange } = useTabsContext();
  const selected = value === selectedValue;

  return (
    <button
      type="button"
      role="tab"
      data-value={value}
      id={`tab-${value}`}
      aria-controls={`tabpanel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => {
        onValueChange(value);
      }}
      className={cn(
        'text-body-medium relative inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 transition-colors disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'bg-surface-container-highest text-on-surface font-medium'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
        focusRing,
        className,
      )}
    >
      <span>{children}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
            selected
              ? 'bg-surface-container text-on-surface'
              : 'bg-surface-container-high text-on-surface-variant',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
