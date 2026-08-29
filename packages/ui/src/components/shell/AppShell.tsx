'use client';

/**
 * `@docket/ui` — the top-level, responsive app shell layout.
 *
 * @remarks
 * Composes the persistent shell regions — the single integrated {@link Sidebar}, an optional
 * multi-document {@link TabBar} above the content, and the main content area — and applies the
 * active org's accent on every context rebind. The accent (from `getOrgAccent`, surfaced by
 * {@link useContextState}) is set inline as the `--org-accent` CSS variable, and the current
 * layout density is reflected via the `data-density` attribute, so descendants can theme to
 * the active org and density without prop drilling.
 *
 * The shell takes the sidebar and tab-bar as nodes rather than rebuilding them, so the host
 * app owns the routing/store wiring while the shell owns the layout and the accent rebinding.
 * {@link AppShell} reads context state and so must be rendered inside a `ContextProvider`.
 *
 * @remarks Visual model — an MD3 tonal surface system. The shell root is the tinted **canvas**
 * (`surface-container`). The `<main>` content is the single distinct **floating rounded surface
 * panel** (`surface`), inset from the window edges by a uniform gutter applied here. The
 * {@link Sidebar} deliberately carries **no panel chrome** — it blends into the canvas tone so
 * the navigation reads as part of the background, not a separate container. The optional
 * {@link TabBar} sits in its **own bar on the canvas** above the main panel as a strip of
 * **detached floating pills**; a column gutter between the strip and the panel keeps the two as
 * visually separate layers rather than one continuous surface.
 *
 * @remarks Responsive model — `lg` is the desktop threshold for the shell frame itself, but the
 * `<main>` panel is also a **container-query context** (`@container`). Because the panel's width is
 * the viewport minus the sidebar and gutters — not the viewport — page content lays itself out
 * against the panel's own inline size (`@md`/`@lg`/`@xl`/`@…` variants) rather than viewport
 * breakpoints. This keeps multi-column layouts from collapsing or overflowing at the medium widths
 * where the panel is much narrower than the window, and lets content grow to use wide panels.
 * - **Desktop (`lg` and up):** the canvas-blended sidebar is static at the left, the content
 *   column (tab bar + main panel) fills the rest, and the uniform gutter floats the main panel.
 * - **Below `lg`:** the static sidebar is hidden. A slim **mobile top bar** appears with a
 *   hamburger that opens the *same* {@link Sidebar} as a left **off-canvas drawer** (a focus-
 *   trapped {@link Sheet}: `Escape`/backdrop dismiss, scroll-lock, return-focus; selecting a nav
 *   row closes it via {@link ShellDrawerProvider}). The main panel goes **full-bleed** (no gutter,
 *   no rounding) so content uses the full width. The tab bar still scrolls horizontally and never
 *   forces horizontal page overflow.
 *
 * @remarks **The layout contract `<main>` is entitled to.** Every surface in Docket renders into this
 * `<main>`, so the shell — not the screen — owns how much of the window a screen gets. Three
 * guarantees, in force at every width, in every rail state, after any sequence of interactions:
 *
 * 1. **Floor.** `<main>` is never narrower than 40% of the viewport, and never below 416px. Below
 *    `lg` it is the *entire* viewport; at `lg` and up it is the viewport minus a constant 328px of
 *    chrome (240px sidebar, 48px activity bar, 40px of gutters) minus the rail. Measured floor:
 *    40.6% (416px) at 1024px with the rail expanded, rising to 57.8% by 1440px.
 *
 *    This floor used to be a *majority*, and the rail was sized by whatever was left under it —
 *    which is how the rail ended up 174px wide on a 1024px window, too narrow to read the panel it
 *    hosts. The two are one equation: `rail ≤ 0.5 × viewport − 328`, so a majority at 1024px caps
 *    the rail at 184px. Giving the rail a 280px floor ({@link RAIL_INLINE_SIZE}) spends `<main>`'s
 *    majority in the 1024–1279 band to buy it. Above 1280px `<main>` is a majority again anyway.
 * 2. **Monotonicity.** Within a layout regime, widening the window never narrows `<main>` — neither
 *    in pixels nor as a share of the viewport. The rail contributes no step to that curve at any
 *    width, because it never *appears* at a threshold: it is in the layout at every desktop width,
 *    and its width is `clamp(17.5rem, 17vw, 22rem)` — continuous, and with a slope below 1 in every
 *    regime so `<main>` still gains from every pixel the window gains. This is the guarantee the
 *    old fixed-width rail actually broke, and nothing here relaxes it.
 * 3. **No occlusion.** At `lg` and up the rail is a flex *sibling* of `<main>`, never a layer over
 *    it, so `<main>`'s rect is also its usable area. Below `lg` the rail is a modal {@link Sheet}
 *    that costs `<main>` nothing.
 *
 * The single discontinuity in the whole shell is the `lg` boundary, where persistent navigation
 * replaces the drawer, and it is unavoidable rather than incidental: any shell whose nav is a drawer
 * below a breakpoint and a docked column above it must give up `nav + gutters` px of `<main>` at that
 * breakpoint, and no choice of breakpoint makes a 1px-wider window repay 320px. It is a nav decision,
 * it costs a bounded 320px, and below it `<main>` already holds 100% of the viewport — the most it
 * can ever hold. The rail adds nothing to it: the rail's own presentation does not change at `lg`
 * either (it is docked at every width at and above it, modal at every width below).
 *
 * This is what replaced a fixed 22rem rail that docked at a threshold. That rail made a *wider*
 * window produce a *narrower* content panel — measured at 1119px of `<main>` at a 1439px viewport
 * and 760px at 1440px — because 400px of chrome arrived in a single pixel of window growth.
 */
import * as React from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { readStoredBoolean, readStoredString, writeStoredValue } from '../../lib/browser-storage';
import { Menu, X } from '../../icons';
import { cn } from '../../lib/utils';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '../../primitives';
import { MobilePanelSwitcher } from './MobilePanelSwitcher';
import { useContextState } from './ContextProvider';
import {
  RAIL_MAX_INLINE_SIZE_PX,
  RAIL_MIN_INLINE_SIZE_PX,
  RAIL_VIEWPORT_SHARE,
  SHELL_ASIDE_SHEET_ID,
  type AppShellAside,
} from './ShellAside';
import { usePageScrollOwner } from './page-scroll';
import { startNavigationTransition } from './navigation-transition';
import { ShellDrawerProvider } from './ShellDrawerContext';
import { ShellSidebarProvider } from './ShellSidebarContext';
import { ShellOverlayProvider } from './ShellOverlayContext';
import { ShellRailDock } from './ShellRailDock';

/** localStorage keys for the shell-owned rail state (active panel + collapsed), persisted across sessions. */
const RAIL_ACTIVE_KEY = 'docket.rail.active';
const RAIL_COLLAPSED_KEY = 'docket.rail.collapsed';

/** localStorage key for the viewer's own sidebar choice, which always outranks the width default. */
const SIDEBAR_COLLAPSED_KEY = 'docket.sidebar.collapsed';

/**
 * The one breakpoint in the shell: at and above it the navigation and the rail are persistent
 * columns; below it both are overlays and `<main>` is the whole viewport.
 *
 * @remarks
 * There is deliberately **no second, higher threshold** for the rail. A rail that switched from
 * overlay to docked partway up the range put a cliff in `<main>`'s width exactly where the switch
 * happened — the whole bug this shell was rebuilt to make unrepresentable. The rail is a docked
 * sibling at every width at or above this query and a modal {@link Sheet} at every width below it,
 * so no amount of resizing changes which of the two the viewer gets *within* a regime.
 *
 * This constant only gates the **modal** presentation, which needs JS because a Radix Sheet's
 * overlay, scroll-lock, and focus-trap must not activate on desktop even when CSS-hidden. The
 * docked columns are hidden/shown in CSS by the components themselves, so the very first paint is
 * already the final layout.
 */
export const SHELL_DESKTOP_QUERY = '(min-width: 64rem)';

/** {@link SHELL_DESKTOP_QUERY}'s threshold in px — the same `lg` breakpoint, for arithmetic. */
export const SHELL_DESKTOP_MIN_PX = 1024;

/**
 * The fixed chrome, in px, that the desktop shell takes out of the viewport before the rail with
 * the sidebar **expanded**: the 240px sidebar, the 48px activity bar, and 40px of gutters (16px of
 * shell padding + three 8px column gaps).
 *
 * @remarks
 * Exported because it is half of the shell's layout contract: `<main>` = viewport − this − rail.
 * It is a constant *within a sidebar state*, which is what makes `<main>`'s share of the viewport
 * strictly increase with viewport width. Documented and asserted rather than merely true today —
 * see `tests/components/shell/shell-layout-contract.test.tsx`.
 */
export const SHELL_DESKTOP_CHROME_PX = 328;

/**
 * The same chrome with the sidebar collapsed to its labeled MD3 rail: an 80px region in place of
 * the expanded sidebar's 256px region. The region includes the shell's 8px leading inset, the
 * 64px navigation column, and the 8px gap before `<main>`.
 *
 * @remarks
 * The column *count* is unchanged, so the 40px of gutters and the 48px activity bar are identical —
 * only the sidebar region's width moves, and it moves by a constant. Collapsing therefore hands
 * `<main>` a flat 176px at every width rather than a share, which is why it can be offered at all
 * widths without putting a slope anywhere in the contract.
 */
export const SHELL_DESKTOP_CHROME_COLLAPSED_PX = 152;

/**
 * The viewport width at or above which the sidebar starts out expanded.
 *
 * @remarks
 * Below this the shell has to spend its width on the content and the rail, and a 240px column of
 * labels is the least valuable of the three — the same daily destinations stay visible in the
 * labeled rail. Sampled **once, at mount**, and only when the viewer has expressed no preference:
 * making it track the window live would mean dragging a window across 1440px silently took 176px
 * away from `<main>`, which is the exact discontinuity the rest of this contract exists to prevent.
 */
export const SHELL_SIDEBAR_EXPAND_MIN_PX = 1440;

/**
 * The share of the viewport `<main>` is guaranteed at **every** width, in **every** rail state,
 * after any sequence of interactions — the floor the shell's layout test enforces over every
 * integer width from 320px to 3840px.
 *
 * @remarks
 * A screen may size itself against this without asking the shell anything: whatever the window is,
 * at least this much of it is the screen's. The binding case is the narrowest desktop width with the
 * rail open (1024px → 416px of `<main>`, 40.6%); every other width has more headroom, and the share
 * only rises from there — past 1280px it is a majority again.
 *
 * It was 0.5 while the rail was sized by subtraction. Holding a majority at 1024px caps the rail at
 * 184px, and a 184px rail cannot show the panels it exists for, so the guarantee moved rather than
 * the panels getting narrower. Raising this back means shrinking {@link RAIL_INLINE_SIZE}'s floor
 * by exactly the same number of pixels; they are one equation, not two knobs.
 */
export const SHELL_MAIN_MIN_VIEWPORT_SHARE = 0.4;

/**
 * `<main>`'s inline size, in px, for a viewport width and rail state — the shell's layout contract
 * expressed as arithmetic.
 *
 * @remarks
 * This is the *specification*, not a measurement: it says what the CSS is required to produce. The
 * shell's layout test pins it to reality from both ends — it asserts the rendered rail carries
 * exactly {@link RAIL_INLINE_SIZE}, and it drives this function across a width sweep to prove the
 * guarantees (monotone in width, never below {@link SHELL_MAIN_MIN_VIEWPORT_SHARE}) hold for *every*
 * width rather than the handful a browser sweep can sample. The browser probe over the running app
 * is what confirms the CSS actually matches it.
 *
 * @param viewportWidth - The viewport's inline size in CSS px.
 * @param railExpanded - Whether the viewer has the rail's panel host expanded.
 * @param sidebarCollapsed - Whether the sidebar is showing its labeled rail rather than the full sidebar.
 * @returns `<main>`'s inline size in CSS px.
 *
 * @example
 * ```ts
 * shellMainInlineSize(1440, true); // 832 — a majority of the viewport
 * shellMainInlineSize(1024, true, true); // 560 — the same window, sidebar collapsed
 * ```
 */
export function shellMainInlineSize(
  viewportWidth: number,
  railExpanded: boolean,
  sidebarCollapsed = false,
): number {
  // Below the one breakpoint the nav is a drawer and the rail is modal, so `<main>` is the viewport.
  if (viewportWidth < SHELL_DESKTOP_MIN_PX) return viewportWidth;
  const rail = railExpanded
    ? Math.min(
        Math.max(RAIL_VIEWPORT_SHARE * viewportWidth, RAIL_MIN_INLINE_SIZE_PX),
        RAIL_MAX_INLINE_SIZE_PX,
      )
    : 0;
  const chrome = sidebarCollapsed ? SHELL_DESKTOP_CHROME_COLLAPSED_PX : SHELL_DESKTOP_CHROME_PX;
  return viewportWidth - chrome - rail;
}

/** The shell-owned, persisted rail state: which panel is active, and whether its host is collapsed. */
interface RailState {
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
 * onto the grid, which needs both on screen at once. The floor in {@link SHELL_MAIN_MIN_VIEWPORT_SHARE}
 * is therefore an *unconditional* guarantee rather than one that depends on the viewer closing a
 * panel — `<main>` keeps a majority of the window at every width **with the rail open**, with no
 * interaction at all.
 *
 * It is deliberately *width-independent*, which the layout contract depends on: a default that
 * varied by viewport would put the cliff this shell exists to prevent back in, across page loads
 * instead of across a resize.
 */
const INITIAL_RAIL_STATE: RailState = { activeId: null, collapsed: false };

/**
 * The persisted rail state, or {@link INITIAL_RAIL_STATE} when unset / unreadable.
 *
 * @remarks
 * Read in an effect rather than in `useState`'s initializer, because the rail is now server-rendered
 * (that is what keeps the desktop chrome a constant width from the very first paint). React does not
 * patch up attribute mismatches it finds while hydrating, so an initializer that returned the
 * *persisted* value on the client and the *default* on the server left the DOM stuck on whichever
 * class the server emitted — the rail silently ignored the viewer's saved choice.
 */
function readRailState(): RailState {
  return {
    activeId: readStoredString(RAIL_ACTIVE_KEY),
    collapsed: readStoredBoolean(RAIL_COLLAPSED_KEY) ?? INITIAL_RAIL_STATE.collapsed,
  };
}

/**
 * Whether the sidebar starts collapsed: the viewer's own saved choice, else the window's width.
 *
 * @remarks
 * Read once, in the same mount effect as the rail, for the same hydration reason. The width is only
 * consulted when nothing is stored — once someone has expressed a preference it is theirs at every
 * width, because a shell that re-decided on every load would keep overriding them.
 *
 * Deliberately **not** re-evaluated on resize. The width test is a first-run default, not a
 * responsive rule: recomputing it live would make dragging a window across
 * {@link SHELL_SIDEBAR_EXPAND_MIN_PX} hand `<main>` 176px less than it had a pixel earlier, which is
 * precisely the discontinuity the layout contract forbids.
 */
function readSidebarCollapsed(): boolean {
  const stored = readStoredBoolean(SIDEBAR_COLLAPSED_KEY);
  if (stored !== null) return stored;
  // No stored choice. Under SSR there is no width to consult either, and `false` is the expanded
  // default the server already rendered.
  if (typeof window === 'undefined') return false;
  return window.innerWidth < SHELL_SIDEBAR_EXPAND_MIN_PX;
}

/** Persist a rail-state value. Storage failures are absorbed by {@link writeStoredValue}. */
function writeRailState(key: string, value: string): void {
  writeStoredValue(key, value);
}

/** A host request for the shell to select and expand one of its existing rail panels. */
export interface AppShellRailRequest {
  /** The stable id of a panel declared in {@link AppShellProps.aside}. */
  readonly panelId: string;
  /** A monotonically increasing caller-owned token that makes repeated requests observable. */
  readonly version: number;
}

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The single integrated navigation {@link Sidebar} (host-wired). */
  sidebar: React.ReactNode;
  /** The optional multi-document {@link TabBar}, rendered above the content. */
  tabBar?: React.ReactNode | undefined;
  /**
   * Optional shell-level banner (e.g. an account nudge), rendered between the tab bar and
   * `<main>` — a sibling of the scrollable content, not part of it.
   *
   * @remarks
   * A page can rely on `h-full` filling `<main>` exactly because `<main>` is the shell's ONE
   * scroll container and nothing else shares its box. A banner rendered as page content (inside
   * `children`) breaks that invariant: it adds its own height on top of a child's `h-full`,
   * silently pushing anything anchored to the page's bottom (a composer, a sticky footer) out of
   * the initial view. Passing it here keeps `<main>`'s `flex-1` sizing already net of the banner,
   * so every page's `h-full` continues to mean "all of the space `<main>` actually has left."
   */
  banner?: React.ReactNode | undefined;
  /**
   * Optional overlay pinned to the top of the content column, above the tab strip and main panel.
   *
   * @remarks
   * For chrome that reports on the shell itself rather than on any page — the navigation progress
   * bar. Rendered as a positioned overlay inside the content column, so it costs no layout: the
   * tab bar and `<main>` keep the exact geometry they have without it, and nothing shifts when it
   * appears or goes away.
   */
  contentOverlay?: React.ReactNode | undefined;
  /**
   * Optional brand content for the **mobile top bar** (shown below `lg`), e.g. the active
   * workspace name/avatar. Rendered between the hamburger and the trailing actions; defaults to
   * the product name when omitted.
   */
  mobileBrand?: React.ReactNode | undefined;
  /**
   * Optional trailing actions for the **mobile top bar** (shown below `lg`), e.g. a search
   * affordance. Rendered at the bar's right edge.
   */
  mobileActions?: React.ReactNode | undefined;
  /**
   * The optional right-hand **rail** — a curated set of Docket-native supplemental panels plus a
   * default. On `lg` and up it renders as a thin always-visible {@link ShellActivityBar} switcher
   * on the far edge plus a collapsible {@link ShellAside} panel host beside it; below `lg` the same
   * panels are presented in a right-anchored {@link Sheet} opened from the mobile top bar. Omit it
   * (or pass no panels) and no rail renders.
   *
   * @remarks
   * A panel supplies content only. It never sizes itself: the rail's inline size is the shell's
   * ({@link RAIL_INLINE_SIZE}), because a panel that could choose its own width could break
   * `<main>`'s guaranteed share. Panels get a `@container` context instead and lay out against the
   * rail's real inline size.
   */
  aside?: AppShellAside | undefined;
  /**
   * An optional, versioned request to select and expand an existing rail panel.
   *
   * @remarks
   * The shell owns rail state. Hosts may request a reveal, but they cannot duplicate or mutate the
   * active-panel and collapsed state that keeps the desktop and mobile rail presentations aligned.
   */
  railRequest?: AppShellRailRequest | undefined;
  /** Report the resolved panel and whether its desktop host is expanded to the host application. */
  onRailStateChange?:
    | ((state: {
        readonly activePanelId: string | null;
        readonly expanded: boolean;
        readonly visible: boolean;
      }) => void)
    | undefined;
  /** Extra class names for the root shell element. */
  className?: string | undefined;
  /** The main-area content. */
  children: React.ReactNode;
}

/**
 * The Docket app shell: a responsive Sidebar + TabBar + main panel (+ optional rail), with
 * org-accent rebinding.
 *
 * @remarks
 * On context rebind the active org's accent is applied as `--org-accent` on the shell root
 * and `data-density` reflects the current density, so the bound org is visually unambiguous
 * throughout the subtree. The same `sidebar` node renders in two slots — the static desktop
 * rail (`lg` and up) and the mobile off-canvas drawer (below `lg`) — so the navigation stays
 * a single source of truth across breakpoints.
 *
 * The optional **right-hand rail** (`aside`) is a host-wired slot, exactly like `sidebar`/`tabBar`:
 * at `lg` and up it renders as a third floating sibling surface in the shell row
 * (`sidebar | content | aside | activity bar`), narrowing the main panel by its share of the
 * viewport; below `lg` the *same* slot is a right-anchored modal {@link Sheet} opened from the
 * mobile top bar. Its state lives here — active panel and collapsed, both persisted, both
 * width-independent — not in any context. The rail defaults to open, which is why the floor below is
 * stated with it open: an untouched shell already satisfies it.
 */
export function AppShell({
  sidebar,
  tabBar,
  banner,
  contentOverlay,
  mobileBrand,
  mobileActions,
  aside,
  railRequest,
  onRailStateChange,
  className,
  children,
}: AppShellProps): React.JSX.Element {
  const { orgAccent, density, activeOrgId } = useContextState();
  const pageScrollOwner = usePageScrollOwner();
  // Drives only the *modal* presentations (the nav drawer's and the rail sheet's focus traps), which
  // cannot be a CSS concern. Every docked column hides itself in CSS, so the layout never depends on
  // this having resolved.
  const isDesktop = useMediaQuery(SHELL_DESKTOP_QUERY);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [overlayPanelOpen, setOverlayPanelOpen] = React.useState(false);
  const [overlayHost, setOverlayHost] = React.useState<HTMLDivElement | null>(null);

  // Rail state is shell-owned and persisted across sessions: which native panel is active, and
  // whether the panel host is collapsed (the activity bar always stays visible). The persisted
  // active id may name a panel not present on the current route, so it is *resolved* against the
  // available panels below rather than clobbered — switching to Agenda on one page shouldn't lose
  // the Tasks default on the calendar.
  const panels = aside?.panels ?? [];
  const [rail, setRail] = React.useState<RailState>(INITIAL_RAIL_STATE);
  // Expanded on the server and on the first client paint, so the markup matches; the mount effect
  // below applies the viewer's choice (or the width default) once hydration is safe.
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const restoreSidebarToggleFocus = React.useRef(false);
  const railCollapsed = rail.collapsed;
  // A node that happens to render `null` cannot reserve space for its sibling rail. Hosts must
  // therefore pass `null` for an empty document collection, rather than an always-mounted TabBar.
  const tabBarPresent = tabBar !== null && tabBar !== undefined && tabBar !== false;

  // Adopt the persisted choice once the DOM the server produced is safely hydrated. See
  // {@link readRailState} for why this cannot be `useState`'s initializer.
  React.useEffect(() => {
    setSidebarCollapsed(readSidebarCollapsed());
  }, []);

  const toggleSidebar = React.useCallback((): void => {
    restoreSidebarToggleFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset['shellSidebarToggle'] === 'true';
    startNavigationTransition(() => {
      setSidebarCollapsed((current) => {
        const next = !current;
        writeRailState(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
        return next;
      });
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!restoreSidebarToggleFocus.current) return;
    document.querySelector<HTMLButtonElement>('[data-shell-sidebar-toggle="true"]')?.focus();
    restoreSidebarToggleFocus.current = false;
  }, [sidebarCollapsed]);

  const sidebarState = React.useMemo(
    () => ({ collapsed: sidebarCollapsed, onToggle: toggleSidebar }),
    [sidebarCollapsed, toggleSidebar],
  );

  React.useEffect(() => {
    setRail(readRailState());
  }, []);

  const activePanel =
    panels.find((panel) => panel.id === rail.activeId) ??
    panels.find((panel) => panel.id === aside?.defaultPanelId) ??
    panels[0] ??
    null;
  const activePanelIdResolved = activePanel?.id ?? '';

  // A request can only select a panel that this route already declared. This keeps a feature such
  // as Athena from manufacturing a second shell state or asking Calendar to host a rail it omitted.
  const handledRailRequest = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!railRequest || handledRailRequest.current === railRequest.version) return;
    handledRailRequest.current = railRequest.version;
    if (!panels.some((panel) => panel.id === railRequest.panelId)) return;
    setRail({ activeId: railRequest.panelId, collapsed: false });
    writeRailState(RAIL_ACTIVE_KEY, railRequest.panelId);
    writeRailState(RAIL_COLLAPSED_KEY, '0');
    if (!isDesktop) setOverlayPanelOpen(true);
  }, [isDesktop, panels, railRequest]);

  React.useEffect(() => {
    onRailStateChange?.({
      activePanelId: activePanelIdResolved || null,
      expanded: activePanel !== null && !railCollapsed,
      visible: activePanel !== null && (isDesktop ? !railCollapsed : overlayPanelOpen),
    });
  }, [
    activePanel,
    activePanelIdResolved,
    isDesktop,
    onRailStateChange,
    overlayPanelOpen,
    railCollapsed,
  ]);

  // Click a panel icon: collapse if it is the already-active, visible panel; otherwise switch to it
  // and expand. Only explicit clicks persist, so passive resolution never overwrites a real choice.
  //
  // The activity bar exists only at desktop widths (it hides itself in CSS), so this always means
  // "toggle the docked panel" — there is no width at which the same control does something else.
  const handlePanelIconClick = React.useCallback(
    (id: string) => {
      if (id === activePanelIdResolved && !railCollapsed) {
        setRail((current) => ({ ...current, collapsed: true }));
        writeRailState(RAIL_COLLAPSED_KEY, '1');
        return;
      }
      setRail({ activeId: id, collapsed: false });
      writeRailState(RAIL_ACTIVE_KEY, id);
      writeRailState(RAIL_COLLAPSED_KEY, '0');
    },
    [activePanelIdResolved, railCollapsed],
  );

  // Stable dismiss callback handed to the drawer-rendered sidebar so a nav selection closes the
  // drawer (the static desktop rail sits under a `null` provider, so it never closes anything).
  const closeDrawer = React.useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // Org-rebind cross-fade: when the bound org changes (not on first mount), replay a short
  // fade-in on the main panel so the context switch is legible. A transient class — not a
  // key-based remount, which would destroy route/page state.
  const [rebinding, setRebinding] = React.useState(false);
  const prevOrgIdRef = React.useRef(activeOrgId);
  React.useEffect(() => {
    if (prevOrgIdRef.current === activeOrgId) return undefined;
    const previousOrgId = prevOrgIdRef.current;
    prevOrgIdRef.current = activeOrgId;
    if (previousOrgId === null) return undefined;
    setRebinding(true);
    const timer = setTimeout(() => {
      setRebinding(false);
    }, 240);
    return () => {
      clearTimeout(timer);
    };
  }, [activeOrgId]);

  return (
    <ShellOverlayProvider host={overlayHost}>
      <div
        data-density={density}
        style={orgAccent ? ({ '--org-accent': orgAccent } as React.CSSProperties) : undefined}
        className={cn(
          // The tinted MD3 canvas: the whole app sits on `surface-container`. Below `lg` the shell
          // is a vertical stack (mobile top bar over the content) with no gutter so the main panel
          // goes full-bleed; at `lg` and up it becomes a horizontal row with a uniform gutter (p-2)
          // so the blended sidebar + floating main panel inset from the window edges.
          // `h-dvh`, not `h-screen`: `100vh` is the *largest* viewport height, so on mobile browsers
          // it sits behind the collapsing URL bar and the shell overflows by exactly that bar's
          // height. The dynamic unit tracks the visible viewport instead.
          //
          // The horizontal safe-area insets matter only once Docket is installed and running without
          // browser chrome: in landscape on a notched device the sidebar would otherwise slide under
          // the notch. They resolve to `0px` everywhere else, so this is inert in a browser tab.
          // Top and bottom insets are applied to the mobile bar and `<main>` rather than here, so the
          // canvas colour still bleeds edge to edge behind the status bar.
          'bg-surface-container text-on-surface flex h-dvh w-full flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:flex-row lg:gap-2 lg:p-2',
          className,
        )}
      >
        {/* Skip-to-content — the first focusable element, visually hidden until focused. Lets a
          keyboard user jump past the workspace switcher + full nav + open document tabs straight
          to the page content (the `<main>` region below is a focus target via `tabIndex={-1}`). */}
        <a
          href="#main-content"
          className="bg-surface text-on-surface border-outline-variant focus-visible:ring-ring text-body-medium sr-only z-50 rounded-md border px-3 py-2 font-medium shadow-sm transition-colors focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          Skip to content
        </a>

        {/* Mobile top bar — shown only below `lg`; opens the sidebar drawer. */}
        {/* `min-h-12` + a top safe-area inset rather than a fixed `h-12`: installed on a notched
          device the bar must grow by the inset so its controls clear the status bar, instead of
          keeping a 48px box and hiding the menu button underneath it. The inset is `0px` in a
          browser tab, where this stays exactly the 48px bar it was. */}
        <div className="border-outline-variant flex min-h-12 shrink-0 items-center gap-2 border-b px-2 pt-[env(safe-area-inset-top)] lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => {
              setDrawerOpen(true);
            }}
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center">
            {mobileBrand ?? <span className="text-body-medium truncate font-semibold">Docket</span>}
          </div>
          {mobileActions}
          {/* Mobile rail trigger — opens the panels as a right sheet. Uses the active panel's glyph. */}
          {activePanel ? (
            <button
              type="button"
              aria-label={`Show ${activePanel.label}`}
              aria-controls={SHELL_ASIDE_SHEET_ID}
              aria-expanded={overlayPanelOpen}
              onClick={() => {
                setOverlayPanelOpen(true);
              }}
              className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-5"
            >
              {activePanel.icon}
            </button>
          ) : null}
        </div>

        {/* Off-canvas navigation drawer — the SAME sidebar node, shown below `lg` on demand. */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            aria-label="Navigation"
            aria-describedby={undefined}
            className="lg:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <ShellSidebarProvider value={sidebarState}>
              <ShellDrawerProvider dismiss={closeDrawer}>{sidebar}</ShellDrawerProvider>
            </ShellSidebarProvider>
          </SheetContent>
        </Sheet>

        {/* Static desktop rail — the canvas-blended sidebar, shown at `lg` and up. */}
        <div className="hidden lg:block">
          <ShellSidebarProvider value={sidebarState}>
            <ShellDrawerProvider dismiss={null}>{sidebar}</ShellDrawerProvider>
          </ShellSidebarProvider>
        </div>

        {/*
        The content column stacks the optional tab strip over the main panel. Each page supplies
        its own internal top inset, while a status banner keeps a small desktop gutter before the
        panel so its message does not run into the page surface.
      */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {contentOverlay}
          {tabBar}
          {banner ? (
            <div data-slot="shell-banner" className="shrink-0 lg:mb-2">
              {banner}
            </div>
          ) : null}
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              // The bottom safe-area inset pads the scroll content so the last row of a list clears
              // the iOS home indicator when installed. It resolves to `0px` in a browser tab and on
              // desktop, so `<main>`'s "a page's `h-full` means all the space `<main>` has left"
              // contract is unchanged there — and still holds when inset, just `inset` px shorter.
              //
              // No border and no shadow: the tonal step from the `surface-container` canvas onto
              // `surface` is the separation, exactly as every other panel in the shell does it. A
              // border plus a drop shadow on the outermost frame drew a second box around content
              // that already had one.
              'bg-surface @container min-h-0 flex-1 outline-none lg:rounded-xl',
              // The default: `<main>` is the shell's one scroll container, with a stable gutter so
              // content does not shift when it grows past the viewport.
              pageScrollOwner === 'shell' &&
                'scrollbar-gutter-stable overflow-auto pb-[env(safe-area-inset-bottom)]',
              // A page that scrolls itself gets the box whole: no scrolling here, so no reserved
              // gutter stealing the right edge, and no bottom padding — the page owns both.
              pageScrollOwner === 'page' && 'overflow-hidden',
              rebinding && 'animate-org-rebind',
            )}
          >
            {children}
          </main>
          <div
            ref={setOverlayHost}
            data-shell-overlay-host=""
            className="pointer-events-none absolute inset-0 z-[109] overflow-hidden"
          />
        </div>

        {/* Right-hand rail. Both columns are rendered at EVERY width whenever the route offers panels
          and hide themselves below `lg` in CSS — no JS gate, no conditional mount. That is what
          holds the desktop chrome at a constant 328px across the whole desktop range: when the host
          was mounted conditionally its flex gap alone cost `<main>` 7px the moment the condition
          flipped, and the panel itself cost 352px more. Collapsed the host is still here, at zero
          width, so collapsing and expanding move exactly one number. */}
        {activePanel ? (
          <ShellRailDock
            panel={activePanel}
            panels={panels}
            activeId={activePanelIdResolved}
            collapsed={railCollapsed}
            tabBarPresent={tabBarPresent}
            onIconClick={handlePanelIconClick}
          />
        ) : null}

        {/* The same panels as one full-window pane below `lg`, opened from the mobile top-bar
          trigger. Material's adaptive supporting-pane model shows only the current pane at compact
          and medium widths, so no strip of the unusable page remains visible underneath. Mounted
          only when the desktop query does *not* match, so Radix's focus trap and scroll-lock never
          activate over a docked rail; it carries its own id ({@link SHELL_ASIDE_SHEET_ID}) because
          the docked host is now in the DOM at every width and the two can no longer share one. A
          single active-panel menu replaces the desktop activity bar. The explicit close action,
          Escape, and browser dismissal all return to the invoking page. */}
        <Sheet
          open={activePanel != null && !isDesktop && overlayPanelOpen}
          onOpenChange={(next) => {
            if (!next) setOverlayPanelOpen(false);
          }}
        >
          <SheetContent
            side="right"
            id={SHELL_ASIDE_SHEET_ID}
            aria-label={activePanel?.label}
            aria-describedby={undefined}
            className="@container inset-0 flex h-dvh w-screen max-w-none flex-col overflow-hidden border-0 shadow-none"
          >
            <SheetTitle className="sr-only">{activePanel?.label}</SheetTitle>
            {!isDesktop && activePanel ? (
              <div
                data-testid="shell-utility-pane-bar"
                className="border-outline-variant flex min-h-12 shrink-0 items-center border-b px-2 pt-[env(safe-area-inset-top)]"
              >
                <div className="min-w-0 flex-1">
                  <MobilePanelSwitcher
                    panels={panels}
                    activePanel={activePanel}
                    onSelect={(panelId) => {
                      setRail((current) => ({ ...current, activeId: panelId }));
                      writeRailState(RAIL_ACTIVE_KEY, panelId);
                    }}
                  />
                </div>
                <SheetClose asChild>
                  <button
                    type="button"
                    aria-label={`Close ${activePanel.label}`}
                    className="text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </button>
                </SheetClose>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">{activePanel?.node}</div>
          </SheetContent>
        </Sheet>
      </div>
    </ShellOverlayProvider>
  );
}
