'use client';

/**
 * `@docket/ui` — the shell's rail state helpers: persistence, counted requests, and panel claims.
 *
 * @remarks
 * Split from `AppShell` so the shell component stays a composition. The rail is shell-owned and
 * persisted (which panel is active, whether its host is collapsed); surfaces that need room ask
 * for the rail to collapse while they are mounted, and a surface that hosts a panel's content
 * itself claims that panel's icon so a click goes to the surface rather than expanding the rail.
 */
import * as React from 'react';

import { readStoredBoolean, readStoredString, writeStoredValue } from '../../lib/browser-storage';
import type { ShellRailState } from './ShellRailContext';

/** localStorage key for the rail's active panel, persisted across sessions. */
export const RAIL_ACTIVE_KEY = 'docket.rail.active';
/** localStorage key for whether the rail's panel host is collapsed, persisted across sessions. */
export const RAIL_COLLAPSED_KEY = 'docket.rail.collapsed';

/** The shell-owned, persisted rail state: which panel is active, and whether its host is collapsed. */
export interface RailState {
  /** The persisted panel id, resolved against the route's panels at render time. */
  readonly activeId: string | null;
  /** Whether the panel host is collapsed to zero width. */
  readonly collapsed: boolean;
}

/**
 * The rail state every first render uses — on the server and on the client's hydrating render.
 *
 * @remarks
 * Expanded, matching the product: the day plan sits beside the calendar so a task can be dragged
 * onto the grid, which needs both on screen at once. The floor in `SHELL_MAIN_MIN_VIEWPORT_SHARE`
 * is therefore an *unconditional* guarantee rather than one that depends on the viewer closing a
 * panel — `<main>` keeps a majority of the window at every width **with the rail open**, with no
 * interaction at all.
 *
 * It is deliberately *width-independent*, which the layout contract depends on: a default that
 * varied by viewport would put the cliff this shell exists to prevent back in, across page loads
 * instead of across a resize.
 */
export const INITIAL_RAIL_STATE: RailState = { activeId: null, collapsed: false };

/**
 * The persisted rail state, or {@link INITIAL_RAIL_STATE} when unset / unreadable.
 *
 * @remarks
 * Read in an effect rather than in `useState`'s initializer, because the rail is server-rendered
 * (that is what keeps the desktop chrome a constant width from the very first paint). React does not
 * patch up attribute mismatches it finds while hydrating, so an initializer that returned the
 * *persisted* value on the client and the *default* on the server left the DOM stuck on whichever
 * class the server emitted — the rail silently ignored the viewer's saved choice.
 */
export function readRailState(): RailState {
  return {
    activeId: readStoredString(RAIL_ACTIVE_KEY),
    collapsed: readStoredBoolean(RAIL_COLLAPSED_KEY) ?? INITIAL_RAIL_STATE.collapsed,
  };
}

/** Persist a rail-state value. Storage failures are absorbed by {@link writeStoredValue}. */
export function writeRailState(key: string, value: string): void {
  writeStoredValue(key, value);
}

/** What {@link useCountedRequests} returns. */
export interface CountedRequests {
  readonly requested: boolean;
  readonly request: () => () => void;
  readonly override: () => void;
}

/**
 * Counted requests from surfaces that need room: a canvas asks for the icon rail, or for the
 * right-hand rail to collapse, while it is mounted. The count is how many are asking; the override
 * is the viewer opening the thing anyway, which stands until every request is released.
 */
export function useCountedRequests(): CountedRequests {
  const [count, setCount] = React.useState(0);
  const [overridden, setOverridden] = React.useState(false);
  const request = React.useCallback((): (() => void) => {
    setCount((current) => current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setCount((current) => {
        const next = Math.max(0, current - 1);
        if (next === 0) setOverridden(false);
        return next;
      });
    };
  }, []);
  const override = React.useCallback(() => {
    setOverridden(true);
  }, []);
  return { requested: count > 0 && !overridden, request, override };
}

/** Whether the rail is collapsed: the viewer's saved choice, or a surface's standing request. */
export function collapsedByChoiceOrRequest(chosen: boolean, requested: boolean): boolean {
  return chosen || requested;
}

/** What {@link useRailPanelClicks} needs from the shell. */
export interface RailPanelClicksInput {
  readonly railCollapse: CountedRequests;
  readonly railCollapsed: boolean;
  /** The active panel id after resolution against the route's panels. */
  readonly activePanelId: string;
  readonly setRail: React.Dispatch<React.SetStateAction<RailState>>;
}

/** What {@link useRailPanelClicks} returns. */
export interface RailPanelClicks {
  /** The activity bar's click handler. */
  readonly handlePanelIconClick: (id: string) => void;
  /** The value the rail context provides to surfaces. */
  readonly railState: ShellRailState;
}

/**
 * Click a panel icon: collapse if it is the already-active, visible panel; otherwise switch to it
 * and expand. Only explicit clicks persist, so passive resolution never overwrites a real choice.
 *
 * @remarks
 * The activity bar exists only at desktop widths (it hides itself in CSS), so this always means
 * "toggle the docked panel" — there is no width at which the same control does something else.
 * Expanding over a surface's collapse request is the
 * viewer's call for as long as that surface is open; it says nothing about what they want
 * elsewhere, so nothing is saved.
 */
export function useRailPanelClicks({
  railCollapse,
  railCollapsed,
  activePanelId,
  setRail,
}: RailPanelClicksInput): RailPanelClicks {
  const handlePanelIconClick = React.useCallback(
    (id: string) => {
      if (railCollapse.requested) {
        railCollapse.override();
        if (id !== activePanelId) setRail((current) => ({ ...current, activeId: id }));
        return;
      }
      if (id === activePanelId && !railCollapsed) {
        setRail((current) => ({ ...current, collapsed: true }));
        writeRailState(RAIL_COLLAPSED_KEY, '1');
        return;
      }
      setRail({ activeId: id, collapsed: false });
      writeRailState(RAIL_ACTIVE_KEY, id);
      writeRailState(RAIL_COLLAPSED_KEY, '0');
    },
    [activePanelId, railCollapse, railCollapsed, setRail],
  );
  const railState = React.useMemo<ShellRailState>(
    () => ({ collapsed: railCollapsed, requestCollapsed: railCollapse.request }),
    [railCollapse.request, railCollapsed],
  );
  return { handlePanelIconClick, railState };
}
