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

import { Ellipsis } from '../icons';
import { CONTROL, CONTROL_RADIUS, useControlSize } from './control';
import { cn } from '../lib/utils';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { focusRing } from './focus';
import { typeClass } from './text';

/**
 * How a selected tab is coloured.
 *
 * @remarks
 * - `neutral` (default) — the selected segment takes a surface step. Right for a tab bar that
 *   switches what a page is showing, where the tabs are navigation and should not compete with the
 *   content under them.
 * - `accent` — the selected segment takes the MD3 secondary-container role. Right for a segmented
 *   control that sets *what an action will do*, where the current setting is a decision the person
 *   made and needs to read as one at a glance.
 */
export type TabsTone = 'neutral' | 'accent';

/** The shared selection state threaded from {@link Tabs} down to each {@link Tab}. */
interface TabsContextValue {
  /** The currently selected tab value. */
  readonly value: string;
  /** Select a tab by value. */
  readonly onValueChange: (value: string) => void;
  /** How the selected segment is coloured. */
  readonly tone: TabsTone;
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
  /** Lower values remain visible first when an overflow-enabled tablist becomes constrained. */
  readonly priority?: number;
}

/** Configuration for the opt-in compact section overflow menu. */
export interface TabsOverflow {
  /** Accessible name for the menu button, such as `More Initiative sections`. */
  readonly menuLabel: string;
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
  /** Keep detail sections reachable in a named overflow menu when the tab lane is constrained. */
  readonly overflow?: TabsOverflow;
  /** How the selected segment is coloured. Defaults to `neutral`. */
  readonly tone?: TabsTone;
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
  tone = 'neutral',
  children,
  className,
  overflow,
}: TabsProps): React.JSX.Element {
  const context = React.useMemo<TabsContextValue>(
    () => ({ value, onValueChange, tone }),
    [value, onValueChange, tone],
  );

  return (
    <TabsContext.Provider value={context}>
      {items ? (
        overflow ? (
          <OverflowTabList label={label} className={className} items={items} overflow={overflow} />
        ) : (
          <TabList label={label} className={className}>
            {items.map((item) => (
              <Tab key={item.value} value={item.value} count={item.count} disabled={item.disabled}>
                {item.label}
              </Tab>
            ))}
          </TabList>
        )
      ) : (
        children
      )}
    </TabsContext.Provider>
  );
}

/** Props for {@link TabList}. */
export interface TabListProps {
  /** Accessible label for the tablist (announced with the tab role). */
  readonly label?: string | undefined;
  /** Extra classes merged onto the resting track. */
  readonly className?: string | undefined;
  /** The {@link Tab} children. */
  readonly children?: React.ReactNode | undefined;
}

/** The set of keys the tablist handles for roving-tabindex navigation. */
const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End']);

function moveTabFocus(
  list: HTMLDivElement | null,
  event: React.KeyboardEvent<HTMLDivElement>,
  onValueChange: (value: string) => void,
): void {
  if (!NAV_KEYS.has(event.key) || !list) return;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
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
  }
  const next = tabs[nextIndex];
  if (!next) return;
  event.preventDefault();
  next.focus();
  const nextValue = next.dataset['value'];
  if (nextValue !== undefined) onValueChange(nextValue);
}

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
  // A standalone tab bar keeps its 40px touch-target floor; only an enclosing `ControlGroup`
  // shrinks it, which is what lets a composer carry a compact two-position toggle without every
  // existing tab bar in the app shrinking with it.
  const size = useControlSize(undefined, 'xl');

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    moveTabFocus(ref.current, event, onValueChange);
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'bg-surface-container inline-flex items-center gap-0.5 p-0.5',
        CONTROL[size].heightPx <= 32 ? 'rounded-md' : 'rounded-lg',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface OverflowTabListProps {
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly items: readonly TabsItem[];
  readonly overflow: TabsOverflow;
}

/** A measured detail-section tab lane that promotes the selected section before hiding others. */
function OverflowTabList({
  label,
  className,
  items,
  overflow,
}: OverflowTabListProps): React.JSX.Element {
  const { value, onValueChange } = useTabsContext();
  const laneRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const measureRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [visibleValues, setVisibleValues] = React.useState<readonly string[]>(() => {
    const first = items[0]?.value;
    return first && first !== value ? [first, value] : [value];
  });

  const visibleSet = React.useMemo(() => new Set(visibleValues), [visibleValues]);
  const visibleItems = items.filter((item) => visibleSet.has(item.value));
  const hiddenItems = items.filter((item) => !visibleSet.has(item.value));

  const recompute = React.useCallback(() => {
    const available = laneRef.current?.clientWidth ?? 0;
    const moreWidth = moreRef.current?.getBoundingClientRect().width ?? 40;
    const widths = new Map(
      items.map((item) => [
        item.value,
        measureRefs.current.get(item.value)?.getBoundingClientRect().width ?? 0,
      ]),
    );
    if (available <= 0 || [...widths.values()].some((width) => width <= 0)) return;

    const selected = items.find((item) => item.value === value);
    const candidates = [...items]
      .filter((item) => item.value !== selected?.value)
      .sort(
        (left, right) =>
          (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER),
      );
    const next = new Set<string>(selected ? [selected.value] : []);
    let used = selected ? (widths.get(selected.value) ?? 0) : 0;
    for (const item of candidates) {
      const width = widths.get(item.value) ?? 0;
      const needsMore = next.size + 1 < items.length;
      if (used + width + (needsMore ? moreWidth : 0) > available) continue;
      next.add(item.value);
      used += width;
    }
    if (next.size === 0 && items[0]) next.add(items[0].value);
    const ordered = items.filter((item) => next.has(item.value)).map((item) => item.value);
    setVisibleValues((current) =>
      current.length === ordered.length && current.every((item, index) => item === ordered[index])
        ? current
        : ordered,
    );
  }, [items, value]);

  React.useLayoutEffect(() => {
    recompute();
    const lane = laneRef.current;
    if (!lane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recompute);
    observer.observe(lane);
    return () => {
      observer.disconnect();
    };
  }, [recompute]);

  React.useLayoutEffect(() => {
    if (visibleSet.has(value)) return;
    const first = items[0]?.value;
    setVisibleValues((current) =>
      first && first !== value
        ? [...new Set([first, value, ...current])]
        : [...new Set([value, ...current])],
    );
  }, [items, value, visibleSet]);

  return (
    <div ref={laneRef} className="flex min-w-0 items-center gap-1">
      <TabList label={label} className={cn('min-w-0 flex-1 overflow-hidden', className)}>
        {visibleItems.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            count={item.count}
            disabled={item.disabled}
            className="max-w-full min-w-0 shrink overflow-hidden whitespace-nowrap"
          >
            {item.label}
          </Tab>
        ))}
      </TabList>
      {hiddenItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={moreRef} variant="ghost" size="icon" aria-label={overflow.menuLabel}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hiddenItems.map((item) => (
              <DropdownMenuItem
                key={item.value}
                {...(item.disabled === undefined ? {} : { disabled: item.disabled })}
                onSelect={() => {
                  onValueChange(item.value);
                }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div aria-hidden="true" className="pointer-events-none invisible absolute whitespace-nowrap">
        {items.map((item) => (
          <TabMeasurement key={item.value} item={item} refs={measureRefs} />
        ))}
      </div>
    </div>
  );
}

function TabMeasurement({
  item,
  refs,
}: {
  item: TabsItem;
  refs: React.RefObject<Map<string, HTMLButtonElement>>;
}): React.JSX.Element {
  return (
    <button
      ref={(element) => {
        if (element) {
          refs.current.set(item.value, element);
        } else {
          refs.current.delete(item.value);
        }
      }}
      type="button"
      className="text-label-large inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5"
    >
      <span>{item.label}</span>
      {item.count !== undefined ? (
        <span className="text-label-small min-w-5 px-1.5">{item.count}</span>
      ) : null}
    </button>
  );
}

/** Props for {@link Tab}. */
export interface TabProps {
  /** Stable tab value (also the `aria-controls`/`id` stem). */
  readonly value: string;
  /** Optional count rendered as a trailing pill. */
  readonly count?: number | undefined;
  /** When `true`, the tab is present but not selectable. */
  readonly disabled?: boolean | undefined;
  /** Extra classes merged onto the tab button. */
  readonly className?: string | undefined;
  /** The visible tab label. */
  readonly children?: React.ReactNode | undefined;
}

/**
 * A single tab trigger with the standard resting/hover/selected treatment.
 *
 * @param props - The {@link TabProps}.
 * @returns the rendered `role="tab"` button.
 */
export function Tab({ value, count, disabled, className, children }: TabProps): React.JSX.Element {
  const { value: selectedValue, onValueChange, tone } = useTabsContext();
  const selected = value === selectedValue;
  const metrics = CONTROL[useControlSize(undefined, 'xl')];

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
        // One type token for both states. Bolding the selected tab would change the label's
        // rendered width, which shifts every tab after it — a size change on interaction, and the
        // reason a tab strip appears to "breathe" as you click along it.
        'relative inline-flex items-center transition-colors disabled:pointer-events-none disabled:opacity-50',
        metrics.minHeight,
        metrics.paddingX,
        metrics.gap,
        metrics.iconApply,
        typeClass(metrics.labelToken),
        CONTROL_RADIUS,
        selected
          ? tone === 'accent'
            ? 'bg-secondary-container text-on-secondary-container'
            : 'bg-surface-container-highest text-on-surface'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
        focusRing,
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'text-label-small inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 tabular-nums',
            selected && tone === 'accent'
              ? 'bg-on-secondary-container/12 text-on-secondary-container'
              : selected
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
