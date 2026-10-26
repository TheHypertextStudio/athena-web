'use client';

import * as React from 'react';
import { cn } from '../lib/utils';
import { focusRingInset } from './focus';
import { Separator } from './separator';

/** Content-tab presentation; contained tabs use surface and shape instead of an underline. */
export type TabsVariant = 'primary' | 'secondary' | 'contained';
/** Layout resolves automatically from the available width unless explicitly scrollable. */
export type TabsLayout = 'auto' | 'scrollable';
/** Source of a selection, so editors can preserve keyboard navigation focus. */
export type TabsActivation = 'keyboard' | 'pointer';

const ScopeContext = React.createContext<string | null>(null);

/** Give one tablist and its sibling panels a unique, stable identity. Nest for independent sets. */
export function TabsScope({
  children,
  scope,
}: {
  readonly children: React.ReactNode;
  readonly scope?: string;
}): React.JSX.Element {
  const id = React.useId();
  return <ScopeContext.Provider value={scope ?? id}>{children}</ScopeContext.Provider>;
}

/** Resolve stable trigger and panel IDs for focus restoration within one scope. */
export function tabIds(scope: string, value: string): { id: string; panelId: string } {
  const key = encodeURIComponent(value);
  return { id: `${scope}-tab-${key}`, panelId: `${scope}-panel-${key}` };
}

/** Associate a caller-owned panel with its scoped tab, including panels with custom markup. */
export function useTabPanelProps(value: string): {
  id: string;
  role: 'tabpanel';
  'aria-labelledby': string;
  tabIndex: number;
} {
  const scope = React.useContext(ScopeContext);
  if (!scope) throw new Error('Tab panels must be rendered within a TabsScope.');
  const ids = tabIds(scope, value);
  return { id: ids.panelId, role: 'tabpanel', 'aria-labelledby': ids.id, tabIndex: 0 };
}

/** Props for a content panel; hidden panels may stay mounted to retain edited input. */
export interface TabPanelProps extends React.HTMLAttributes<HTMLElement> {
  readonly value: string;
  readonly as?: 'div' | 'section' | 'fieldset';
  /** Lazily render contents while visible, retaining the hidden panel shell. */
  readonly render?: () => React.ReactNode;
  readonly disabled?: boolean;
}

/** Render the associated panel without imposing layout or unmounting policy. */
export function TabPanel({
  value,
  as = 'div',
  render,
  children,
  ...props
}: TabPanelProps): React.JSX.Element {
  const association = useTabPanelProps(value);
  return React.createElement(
    as,
    {
      ...association,
      ...props,
      className: cn(props.className, props.hidden && 'hidden'),
    },
    render ? (props.hidden ? null : render()) : children,
  );
}

/** One content destination in a tablist. */
export interface TabsItem {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly ariaLabel?: string;
  readonly count?: number;
  readonly emphasis?: boolean;
  readonly disabled?: boolean;
}

interface TabsContextValue {
  readonly value: string;
  readonly focusValue: string;
  readonly onValueChange: (value: string, source?: TabsActivation) => void;
  readonly variant: TabsVariant;
  readonly layout: TabsLayout;
  readonly density: 'comfortable' | 'compact';
  readonly scope: string;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);
const SELECTED_TAB_CLASSES: Record<TabsVariant, string> = {
  primary: 'text-primary',
  secondary: 'text-on-surface',
  contained: 'bg-secondary-container text-on-secondary-container',
};

function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs.* subcomponents must be rendered within a <Tabs> root.');
  return context;
}

/** Props for controlled, data-driven or composable content tabs. */
export interface TabsProps {
  readonly value: string;
  readonly onValueChange: (value: string, source?: TabsActivation) => void;
  readonly label?: string;
  readonly items?: readonly TabsItem[];
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly variant?: TabsVariant;
  readonly layout?: TabsLayout;
  /** Compact gutters for narrow work panes; labels retain the full Material type size. */
  readonly density?: 'comfortable' | 'compact' | undefined;
}

/** Retain a keyboard entry point when form validity disables the selected destination. */
function tabFocusValue(items: readonly TabsItem[] | undefined, value: string): string {
  if (!items) return value;
  const current = items.find((item) => item.value === value && !item.disabled);
  return current?.value ?? items.find((item) => !item.disabled)?.value ?? value;
}

/** Render content navigation. Wrap tabs and sibling panels in TabsScope. */
export function Tabs({
  value,
  onValueChange,
  label,
  items,
  children,
  className,
  variant = 'primary',
  layout = 'auto',
  density = 'comfortable',
}: TabsProps): React.JSX.Element {
  const inheritedScope = React.useContext(ScopeContext);
  const ownScope = React.useId();
  const scope = inheritedScope ?? ownScope;
  const focusValue = tabFocusValue(items, value);
  const context = React.useMemo(
    () => ({ value, focusValue, onValueChange, variant, layout, density, scope }),
    [value, focusValue, onValueChange, variant, layout, density, scope],
  );
  return (
    <TabsContext.Provider value={context}>
      {items ? (
        <TabList label={label} className={className}>
          {items.map(({ label: text, ...item }) => (
            <Tab key={item.value} {...item}>
              {text}
            </Tab>
          ))}
        </TabList>
      ) : (
        children
      )}
    </TabsContext.Provider>
  );
}

/** Props for the track of a composable tablist. */
export interface TabListProps {
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children?: React.ReactNode;
}

/** Scroll only the tab lane, preserving the surrounding page's position. */
function revealTab(list: HTMLDivElement, tab: HTMLElement): void {
  const lane = list.getBoundingClientRect();
  const item = tab.getBoundingClientRect();
  if (item.left < lane.left) list.scrollLeft -= lane.left - item.left;
  else if (item.right > lane.right) list.scrollLeft += item.right - lane.right;
}

function handleTabKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  onChange: (value: string, source?: TabsActivation) => void,
): void {
  const list = event.currentTarget;
  if (!(event.target instanceof HTMLElement) || event.target.closest('[role="tablist"]') !== list)
    return;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
  const current = tabs.findIndex((tab) => tab === document.activeElement);
  const rtl = getComputedStyle(list).direction === 'rtl';
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else if (event.key === 'ArrowRight')
    next = (current + (rtl ? -1 : 1) + tabs.length) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (current + (rtl ? 1 : -1) + tabs.length) % tabs.length;
  else return;
  const tab = tabs[next];
  if (!tab) return;
  event.preventDefault();
  tab.focus({ preventScroll: true });
  revealTab(list, tab);
  if (tab.dataset['value'] !== undefined) onChange(tab.dataset['value'], 'keyboard');
}

/** Fit up to four tabs; compact lanes use content widths, while comfortable lanes use equal widths. */
export function TabList({ label, className, children }: TabListProps): React.JSX.Element {
  const { value, variant, layout, density, onValueChange } = useTabsContext();
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = React.useState(layout === 'scrollable');
  React.useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = (): void => {
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
      const widths = tabs.map((tab) => {
        const content = tab.querySelector<HTMLElement>('[data-tab-content]');
        return (
          (content?.getBoundingClientRect().width ?? 0) +
          (density === 'compact' ? 16 : variant === 'contained' ? 32 : 48)
        );
      });
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (selected) revealTab(list, selected);
      const available =
        list.clientWidth - (variant === 'contained' ? 8 + 4 * Math.max(0, tabs.length - 1) : 0);
      const required =
        density === 'compact'
          ? widths.reduce((total, width) => total + width, 0)
          : Math.max(0, ...widths) * tabs.length;
      setScrollable(layout === 'scrollable' || tabs.length > 4 || required > available);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(list);
    list.querySelectorAll('[data-tab-content]').forEach((content) => observer?.observe(content));
    return () => observer?.disconnect();
  }, [children, layout, variant, density]);
  React.useLayoutEffect(() => {
    const list = ref.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && selected) revealTab(list, selected);
  }, [value, scrollable]);
  return (
    <div className="relative w-full min-w-0">
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        data-layout={scrollable ? 'scrollable' : 'fixed'}
        onKeyDown={(event) => {
          handleTabKey(event, onValueChange);
        }}
        onFocus={(event) => {
          if (event.target.getAttribute('role') === 'tab')
            revealTab(event.currentTarget, event.target);
        }}
        className={cn(
          'relative flex h-12 w-full min-w-0 shrink-0 scrollbar-none overflow-x-auto overflow-y-hidden',
          scrollable
            ? '[&>[role=tab]]:flex-none'
            : density === 'compact'
              ? '[&>[role=tab]]:flex-auto'
              : '[&>[role=tab]]:flex-1',
          variant === 'contained'
            ? 'gap-1 p-1'
            : scrollable && density !== 'compact' && 'ps-[52px]',
          className,
        )}
      >
        {children}
      </div>
      {variant === 'contained' ? null : (
        <Separator className="pointer-events-none absolute inset-x-0 bottom-0" />
      )}
    </div>
  );
}

/** Props for a single content-tab trigger. */
export interface TabProps {
  readonly value: string;
  readonly count?: number | undefined;
  readonly emphasis?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children?: React.ReactNode;
}

/** Bound visual counts to four characters; accessible names retain the full count. */
export function tabBadgeCount(count: number): string {
  return count > 999 ? '999+' : String(count);
}

function accessibleTabName(
  children: React.ReactNode,
  count: number | undefined,
  explicit: string | undefined,
): string | undefined {
  const label = explicit ?? (typeof children === 'string' ? children : undefined);
  return label === undefined ? undefined : count === undefined ? label : `${label} ${count}`;
}

/** Render a tab with its chosen indicator or contained selected surface. */
export function Tab({
  value,
  count,
  emphasis,
  ariaLabel,
  disabled,
  className,
  children,
}: TabProps): React.JSX.Element {
  const context = useTabsContext();
  const selected = value === context.value;
  const ids = tabIds(context.scope, value);
  const label = accessibleTabName(children, count, ariaLabel);
  return (
    <button
      type="button"
      role="tab"
      data-value={value}
      id={ids.id}
      aria-controls={ids.panelId}
      aria-selected={selected}
      aria-label={label}
      tabIndex={value === context.focusValue ? 0 : -1}
      disabled={disabled}
      onClick={(event) => {
        context.onValueChange(value, event.detail === 0 ? 'keyboard' : 'pointer');
      }}
      className={cn(
        'text-title-small hover:bg-on-surface/8 active:bg-on-surface/12 relative inline-flex h-full min-w-0 shrink-0 items-center justify-center px-6 whitespace-nowrap transition-colors disabled:opacity-50',
        context.variant === 'contained' && 'rounded-full px-4',
        context.density === 'compact' && 'min-w-max px-2',
        selected ? SELECTED_TAB_CLASSES[context.variant] : 'text-on-surface-variant',
        focusRingInset,
        className,
      )}
    >
      <span data-tab-content="" className="inline-flex h-full items-center gap-1">
        <span className="relative inline-flex h-full items-center">
          {children}
          {selected && context.variant === 'primary' ? (
            <span
              aria-hidden="true"
              data-tab-indicator="primary"
              className="bg-primary absolute bottom-0 left-1/2 z-10 h-[3px] w-[calc(100%-4px)] min-w-6 -translate-x-1/2 rounded-t-full"
            />
          ) : null}
        </span>
        {count === undefined ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'text-label-small inline-flex min-w-4 items-center justify-center rounded-full px-1',
              emphasis
                ? 'bg-error text-on-error'
                : 'bg-surface-container-high text-on-surface-variant',
            )}
          >
            {tabBadgeCount(count)}
          </span>
        )}
      </span>
      {selected && context.variant === 'secondary' ? (
        <span
          aria-hidden="true"
          data-tab-indicator="secondary"
          className="bg-primary absolute inset-x-0 bottom-0 z-10 h-0.5"
        />
      ) : null}
    </button>
  );
}

/** Props for stable panel shells whose expensive contents mount only while selected. */
export interface LazyTabPanelsProps extends TabPanelProps {
  readonly values: readonly string[];
}

/** Keep every trigger target present while preserving caller-owned lazy content and queries. */
export function LazyTabPanels({
  values,
  value,
  children,
  hidden,
  ...props
}: LazyTabPanelsProps): React.JSX.Element {
  return (
    <>
      {values.map((entry) => (
        <TabPanel key={entry} {...props} value={entry} hidden={hidden === true || entry !== value}>
          {entry === value ? children : null}
        </TabPanel>
      ))}
    </>
  );
}
