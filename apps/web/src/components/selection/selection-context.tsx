'use client';

/**
 * `components/selection/selection-context` — one list's selection, bound to the DOM.
 *
 * @remarks
 * Wrap any view that renders more than one object in a {@link SelectionProvider} and every row
 * gains the platform selection conventions at once: modifier-click, keyboard range extension,
 * select-all, and a checkbox for people who would rather point than chord. The rules themselves
 * are pure and live in {@link ./selection-model}; this module is only their DOM and React binding.
 *
 * ## What a surface owns and what this owns
 *
 * The surface owns semantics — whether its container is a `grid`, a `listbox`, or a `table`, and
 * what each row's role is — because only the surface knows what it is rendering. This owns
 * `aria-multiselectable`, `aria-selected`, the roving `tabIndex`, focus movement, and every
 * keystroke in the selection contract.
 *
 * ## Click does not navigate
 *
 * A plain click *selects*, because a range has to start somewhere and "click row 1, shift-click
 * row 5" is the gesture everyone already knows. Opening a row is therefore the job of a real
 * `<a href>` on its title — which is better anyway: it is keyboard-operable, middle-clickable,
 * and copyable, none of which a container `onClick` gives you. Surfaces that genuinely have no
 * detail route can pass `activateOnClick` to opt back in.
 */
import {
  createContext,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { objectKey, type ObjectActionScope, type ObjectRef } from '@/lib/actions/object';
import { useResolvedActions } from '@/lib/actions/registry-context';
import type { ActionSource, ResolvedAction } from '@/lib/actions/types';

import {
  applySelectionIntent,
  EMPTY_SELECTION,
  intentFromClick,
  pruneSelection,
  resolveSelectionKey,
  type SelectionIntent,
  type SelectionState,
} from './selection-model';
import { registerSelectionSurface, type SelectionSurfaceSnapshot } from './selection-registry';

/** The props a selection surface spreads onto its scrolling/list container. */
export interface SelectionContainerProps {
  /** Identifies the surface to global handlers such as the right-click menu. */
  readonly 'data-selection-surface': string;
  /** Announces that more than one row may be selected. Requires a grid/listbox/table role. */
  readonly 'aria-multiselectable': true;
  /** The selection keyboard contract. */
  readonly onKeyDown: (event: ReactKeyboardEvent) => void;
}

/** What {@link useSelection} exposes. */
export interface SelectionContextValue {
  /** This surface's id. */
  readonly surfaceId: string;
  /** The action authority shared by this surface's selectable objects. */
  readonly actionScope: ObjectActionScope;
  /** Every selectable object the surface renders, in view order. */
  readonly items: readonly ObjectRef[];
  /** The selected object keys. */
  readonly selectedKeys: ReadonlySet<string>;
  /** The selected objects, in view order. */
  readonly selectedObjects: readonly ObjectRef[];
  /** How many rows are selected. */
  readonly count: number;
  /** The keyboard-active row's key, or `null`. */
  readonly activeKey: string | null;
  /** The key from which the next range selection extends, or `null`. */
  readonly anchorKey: string | null;
  /** Whether a key is selected. */
  readonly isSelected: (key: string) => boolean;
  /** Apply a selection intent directly (a "select all" button, restoring persisted state). */
  readonly dispatch: (intent: SelectionIntent) => void;
  /** Apply an intent against table-provided eligible order after validating provider membership. */
  readonly dispatchInOrder: (
    intent: SelectionIntent,
    orderedSelectionKeys: readonly string[],
  ) => void;
  /** Select every row. */
  readonly selectAll: () => void;
  /** Clear the selection. */
  readonly clear: () => void;
  /** Props for the list container. */
  readonly containerProps: SelectionContainerProps;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/** A stable empty list, so hooks outside a selection surface keep a stable dependency identity. */
const NO_OBJECTS: readonly ObjectRef[] = [];

/** Props for {@link SelectionProvider}. */
export interface SelectionProviderProps {
  /**
   * Every selectable object the view renders, in the order it renders them.
   *
   * @remarks
   * Order is load-bearing: it is what a shift-click range is cut from. Pass the same array the
   * rows are mapped from, after filtering and sorting, not the unfiltered source. Memoize it
   * (`useMemo`) so the surface is not rebuilding the row order on every keystroke elsewhere.
   */
  readonly items: readonly ObjectRef[];
  /** A stable id for the surface. Defaults to a generated one, which is fine for a single list. */
  readonly surfaceId?: string;
  /** The workspace these items belong to, or `null` for a cross-workspace view. */
  readonly organizationId?: string | null;
  /** The action authority shared by every selectable item in this surface. */
  readonly actionScope: ObjectActionScope;
  /** Open a row — invoked on Enter, and on click when `activateOnClick` is set. */
  readonly onActivate?: (object: ObjectRef) => void;
  /**
   * Make a plain click open the row instead of selecting it.
   *
   * @remarks
   * Only for surfaces whose rows have no title link to carry navigation. Setting it means shift-
   * and ⌘-click still select, but a plain click no longer establishes an anchor, so a range must
   * be started with ⌘-click or the keyboard.
   */
  readonly activateOnClick?: boolean;
  /** The rows. */
  readonly children: ReactNode;
}

/**
 * Give a list-like view the standard multi-select behavior.
 *
 * @param props - The rendered items and the surface's activation policy.
 * @returns The provider element.
 *
 * @example
 * ```tsx
 * <SelectionProvider items={taskRefs} organizationId={orgId} actionScope="all" onActivate={open}>
 *   <TaskRows />
 * </SelectionProvider>
 *
 * // …and inside TaskRows:
 * const { containerProps } = useSelection();
 * <div role="grid" {...containerProps}>{rows}</div>
 * ```
 */
export function SelectionProvider({
  items,
  surfaceId,
  organizationId = null,
  actionScope,
  onActivate,
  activateOnClick = false,
  children,
}: SelectionProviderProps): JSX.Element {
  const generatedId = useId();
  const id = surfaceId ?? generatedId;
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);

  const order = useMemo(() => items.map((item) => objectKey(item)), [items]);
  const byKey = useMemo(() => new Map(items.map((item) => [objectKey(item), item])), [items]);

  // Rows that disappear must not stay selected — a bulk action would otherwise act on something
  // the viewer can no longer see.
  useEffect(() => {
    setState((current) => pruneSelection(current, order));
  }, [order]);

  const dispatch = useCallback(
    (intent: SelectionIntent) => {
      setState((current) => applySelectionIntent(current, intent, order));
    },
    [order],
  );
  const dispatchInOrder = useCallback(
    (intent: SelectionIntent, orderedSelectionKeys: readonly string[]) => {
      const providerKeys = new Set(order);
      const validatedOrder = orderedSelectionKeys.filter((key) => providerKeys.has(key));
      setState((current) => applySelectionIntent(current, intent, validatedOrder));
    },
    [order],
  );

  const selectedObjects = useMemo(
    () => items.filter((item) => state.selected.has(objectKey(item))),
    [items, state.selected],
  );

  // Global handlers (the right-click menu) read the live selection through this registry.
  const snapshotRef = useRef<SelectionSurfaceSnapshot>({
    surfaceId: id,
    organizationId,
    actionScope,
    selectedObjects,
  });
  useEffect(() => {
    snapshotRef.current = { surfaceId: id, organizationId, actionScope, selectedObjects };
  });
  useEffect(() => registerSelectionSurface(id, () => snapshotRef.current), [id]);

  // Focus follows the active row, but only once focus is already inside the list — arrowing must
  // move focus, while a background change must never steal it.
  const containerRef = useRef<HTMLElement | null>(null);
  const rowElements = useRef(new Map<string, HTMLElement>());
  const registerRow = useCallback((key: string, element: HTMLElement | null) => {
    if (element === null) rowElements.current.delete(key);
    else rowElements.current.set(key, element);
  }, []);

  const activeKey = state.activeKey;
  useEffect(() => {
    if (activeKey === null) return;
    const container = containerRef.current;
    const row = rowElements.current.get(activeKey);
    if (container === null || row === undefined) return;
    if (!container.contains(document.activeElement)) return;
    if (document.activeElement !== row) row.focus();
  }, [activeKey]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // A keystroke inside a text field belongs to the text field, not to the list.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const resolution = resolveSelectionKey(event, state, order);
      if (!resolution.handled) return;
      event.preventDefault();
      if (resolution.intent !== null) dispatch(resolution.intent);
      if (resolution.activate && state.activeKey !== null) {
        const object = byKey.get(state.activeKey);
        if (object !== undefined) onActivate?.(object);
      }
    },
    [state, order, dispatch, byKey, onActivate],
  );

  const value = useMemo<SelectionContextValue>(
    () => ({
      surfaceId: id,
      actionScope,
      items,
      selectedKeys: state.selected,
      selectedObjects,
      count: state.selected.size,
      activeKey: state.activeKey,
      anchorKey: state.anchorKey,
      isSelected: (key) => state.selected.has(key),
      dispatch,
      dispatchInOrder,
      selectAll: () => {
        dispatch({ type: 'select-all' });
      },
      clear: () => {
        dispatch({ type: 'clear' });
      },
      containerProps: {
        'data-selection-surface': id,
        'aria-multiselectable': true,
        onKeyDown,
      },
    }),
    [
      id,
      actionScope,
      items,
      state.selected,
      state.activeKey,
      state.anchorKey,
      selectedObjects,
      dispatch,
      dispatchInOrder,
      onKeyDown,
    ],
  );

  const internals = useMemo<SelectionInternals>(
    () => ({
      order,
      registerRow,
      containerRef,
      activateOnClick,
      onActivate: onActivate ?? null,
      dispatch,
    }),
    [order, registerRow, activateOnClick, onActivate, dispatch],
  );

  return (
    <SelectionContext.Provider value={value}>
      <SelectionInternalsContext.Provider value={internals}>
        {children}
      </SelectionInternalsContext.Provider>
    </SelectionContext.Provider>
  );
}

/** Machinery rows need that consumers never should. */
interface SelectionInternals {
  readonly order: readonly string[];
  readonly registerRow: (key: string, element: HTMLElement | null) => void;
  readonly containerRef: { current: HTMLElement | null };
  readonly activateOnClick: boolean;
  readonly onActivate: ((object: ObjectRef) => void) | null;
  readonly dispatch: (intent: SelectionIntent) => void;
}

const SelectionInternalsContext = createContext<SelectionInternals | null>(null);

/** Thrown when a selection hook is used outside a {@link SelectionProvider}. */
class MissingSelectionSurfaceError extends Error {
  constructor() {
    super('No selection surface is mounted. Wrap the list in <SelectionProvider>.');
    this.name = 'MissingSelectionSurfaceError';
  }
}

/**
 * The enclosing list's selection.
 *
 * @returns The surface's {@link SelectionContextValue}.
 * @throws When no {@link SelectionProvider} is mounted above.
 */
export function useSelection(): SelectionContextValue {
  const value = useContext(SelectionContext);
  if (value === null) throw new MissingSelectionSurfaceError();
  return value;
}

/**
 * The enclosing list's selection, or `null` outside one.
 *
 * @remarks
 * For components that render both inside and outside a selectable list (a row shared by a table
 * and a detail page) and must not require the provider.
 *
 * @returns The surface's selection, or `null`.
 */
export function useOptionalSelection(): SelectionContextValue | null {
  return useContext(SelectionContext);
}

/** Read the row-level internals, or explain what is missing. */
function useSelectionInternals(): SelectionInternals {
  const value = useContext(SelectionInternalsContext);
  if (value === null) throw new MissingSelectionSurfaceError();
  return value;
}

/**
 * Attach a container ref so the surface's focus management works.
 *
 * @remarks
 * Returned separately from `containerProps` because a ref cannot be spread through an arbitrary
 * component's props without that component forwarding it, and many list containers are plain
 * elements where a direct `ref` is simpler.
 *
 * @returns A ref callback for the list container element.
 */
export function useSelectionContainerRef(): (element: HTMLElement | null) => void {
  const { containerRef } = useSelectionInternals();
  return useCallback(
    (element: HTMLElement | null) => {
      containerRef.current = element;
    },
    [containerRef],
  );
}

/** The props a selectable row spreads onto its root element. */
export interface SelectableRowProps {
  /** Announces the row's selected state. Requires a row/option/gridcell/treeitem role. */
  readonly 'aria-selected': boolean;
  /** Style hook for the selected treatment. */
  readonly 'data-selected': boolean;
  /** Style hook for the keyboard-active treatment. */
  readonly 'data-active': boolean;
  /** Roving tab index: exactly one row in the list is tabbable at a time. */
  readonly tabIndex: number;
  /** Registers the element so the list can move focus to it. */
  readonly ref: (element: HTMLElement | null) => void;
  /** The modifier-click contract. */
  readonly onClick: (event: ReactMouseEvent) => void;
}

/** What {@link useSelectableRow} returns. */
export interface SelectableRowBinding {
  /** Whether this row is selected. */
  readonly selected: boolean;
  /** Whether this row is the keyboard-active row. */
  readonly active: boolean;
  /** Props for the row root. */
  readonly rowProps: SelectableRowProps;
  /** Toggle just this row — what the row's checkbox calls. */
  readonly toggle: () => void;
}

/**
 * Bind one row into its list's selection.
 *
 * @param object - The object this row renders.
 * @returns The row's selection state and the props to spread onto its root.
 *
 * @example
 * ```tsx
 * const { rowProps, selected } = useSelectableRow(task);
 * const drag = useDraggable({ object: task, actionScope: selection.actionScope });
 * <div role="row" {...objectTargetProps(task)} {...rowProps} {...drag}
 *      className={cn('flex h-10 items-center', drag.className, selected && 'bg-secondary-container')}>
 *   <SelectionCheckbox object={task} />
 *   <a href={`/tasks/${task.id}`}>{task.title}</a>
 * </div>
 * ```
 */
export function useSelectableRow(object: ObjectRef): SelectableRowBinding {
  const selection = useSelection();
  const { order, registerRow, activateOnClick, onActivate, dispatch } = useSelectionInternals();
  const key = objectKey(object);
  const selected = selection.selectedKeys.has(key);
  const active = selection.activeKey === key;
  // Exactly one row is tabbable: the active one, or the first when focus has never entered.
  const tabIndex = active || (selection.activeKey === null && order[0] === key) ? 0 : -1;

  const ref = useCallback(
    (element: HTMLElement | null) => {
      registerRow(key, element);
    },
    [registerRow, key],
  );

  const onClick = useCallback(
    (event: ReactMouseEvent) => {
      // A click that landed on a link or a control inside the row belongs to that control.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        target.closest('a[href], button, input, select, textarea, [role="button"]') !== null
      ) {
        return;
      }
      const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey;
      if (plain && activateOnClick) {
        dispatch({ type: 'move-active', key });
        onActivate?.(object);
        return;
      }
      dispatch(intentFromClick(key, event));
    },
    [activateOnClick, dispatch, key, object, onActivate],
  );

  const toggle = useCallback(() => {
    dispatch({ type: 'toggle', key });
  }, [dispatch, key]);

  return useMemo<SelectableRowBinding>(
    () => ({
      selected,
      active,
      toggle,
      rowProps: {
        'aria-selected': selected,
        'data-selected': selected,
        'data-active': active,
        tabIndex,
        ref,
        onClick,
      },
    }),
    [selected, active, tabIndex, ref, onClick, toggle],
  );
}

/**
 * Every registered action applicable to the current selection.
 *
 * @remarks
 * The bulk-action bar and the multi-object right-click menu render from this, so a selection of
 * five tasks offers exactly the actions that accept five tasks — no per-surface action lists, and
 * nothing offered that would fail.
 *
 * @param source - Which entry point will invoke them. Defaults to `'bulk-bar'`.
 * @returns The applicable actions, grouped and ordered for display.
 */
export function useSelectionActions(source: ActionSource = 'bulk-bar'): readonly ResolvedAction[] {
  const selection = useOptionalSelection();
  const objects = selection?.selectedObjects ?? NO_OBJECTS;
  const surfaceId = selection?.surfaceId;
  const actionScope = selection?.actionScope ?? 'reference';
  const resolveContext = useCallback(
    () => ({
      objects,
      source,
      organizationId: objects[0]?.organizationId ?? null,
      actionScope,
      ...(surfaceId === undefined ? {} : { surfaceId }),
    }),
    [actionScope, objects, source, surfaceId],
  );
  return useResolvedActions(resolveContext);
}
