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
 * @remarks Rail docking is a **separate, higher threshold** than the shell frame — see
 * {@link RAIL_DOCK_QUERY}. A docked rail is a flex sibling that takes its width out of `<main>`, so
 * docking it the moment the sidebar appears made a *wider* window produce a *narrower* content
 * panel. Below the dock threshold the same panels open as a right overlay {@link Sheet} instead,
 * which costs `<main>` nothing.
 */
import * as React from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Menu } from '../../icons';
import { cn } from '../../lib/utils';
import { Sheet, SheetContent, SheetTitle } from '../../primitives';
import { ShellActivityBar } from './ShellActivityBar';
import { useContextState } from './ContextProvider';
import { SHELL_ASIDE_ID, ShellAside, type AppShellAside } from './ShellAside';
import { ShellDrawerProvider } from './ShellDrawerContext';

/** localStorage keys for the shell-owned rail state (active panel + collapsed), persisted across sessions. */
const RAIL_ACTIVE_KEY = 'docket.rail.active';
const RAIL_COLLAPSED_KEY = 'docket.rail.collapsed';

/**
 * The width at which the right rail is allowed to **dock** as a flex sibling of `<main>`.
 *
 * @remarks
 * Deliberately far above the `lg` shell threshold. A docked rail is 22rem of panel plus the 3rem
 * activity bar, and the static sidebar is another 16rem, so docking at `lg` left `<main>` with
 * ~344px at 1024px wide — a *wider* window produced a *three-times narrower* content panel, and any
 * multi-column page (the calendar most visibly) collapsed to a single clipped column.
 *
 * 90rem is the smallest width at which the sidebar, a docked rail, and a content panel that is
 * still the largest region on screen all fit. Below it the same panels are one click away as a
 * right overlay {@link Sheet} from the always-visible {@link ShellActivityBar}, which takes nothing
 * from `<main>` — so widening the window never shrinks the content.
 */
const RAIL_DOCK_QUERY = '(min-width: 90rem)';

/** The persisted active-panel id, or null when unset / unavailable (SSR). */
function readRailActive(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(RAIL_ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** The persisted collapsed flag (defaults to expanded). */
function readRailCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist a rail-state value, ignoring storage failures (private mode, quota). */
function writeRailState(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The single integrated navigation {@link Sidebar} (host-wired). */
  sidebar: React.ReactNode;
  /** The optional multi-document {@link TabBar}, rendered above the content. */
  tabBar?: React.ReactNode;
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
  banner?: React.ReactNode;
  /**
   * Optional brand content for the **mobile top bar** (shown below `lg`), e.g. the active
   * workspace name/avatar. Rendered between the hamburger and the trailing actions; defaults to
   * the product name when omitted.
   */
  mobileBrand?: React.ReactNode;
  /**
   * Optional trailing actions for the **mobile top bar** (shown below `lg`), e.g. a search
   * affordance. Rendered at the bar's right edge.
   */
  mobileActions?: React.ReactNode;
  /**
   * The optional right-hand **rail** — a curated set of Docket-native supplemental panels plus a
   * default. On `lg` and up it renders as a thin always-visible {@link ShellActivityBar} switcher
   * on the far edge plus a collapsible {@link ShellAside} panel host beside it; below `lg` the same
   * panels are presented in a right-anchored {@link Sheet} opened from the mobile top bar. Omit it
   * (or pass no panels) and no rail renders.
   */
  aside?: AppShellAside;
  /** Extra class names for the root shell element. */
  className?: string;
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
 * (`sidebar | content | aside`), narrowing the main panel; below `lg` the *same* slot is a
 * right-anchored {@link Sheet} opened from the mobile top bar. Its open-state lives here — the rail
 * is collapsible (shown by default), the sheet is modal (hidden by default) — not in any context.
 */
export function AppShell({
  sidebar,
  tabBar,
  banner,
  mobileBrand,
  mobileActions,
  aside,
  className,
  children,
}: AppShellProps): React.JSX.Element {
  const { orgAccent, density, activeOrgId } = useContextState();
  const isLgUp = useMediaQuery('(min-width: 64rem)');
  const canDockRail = useMediaQuery(RAIL_DOCK_QUERY);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [overlayPanelOpen, setOverlayPanelOpen] = React.useState(false);

  // Rail state is shell-owned and persisted across sessions: which native panel is active, and
  // whether the panel host is collapsed (the activity bar always stays visible). The persisted
  // active id may name a panel not present on the current route, so it is *resolved* against the
  // available panels below rather than clobbered — switching to Agenda on one page shouldn't lose
  // the Tasks default on the calendar.
  const panels = aside?.panels ?? [];
  const [activePanelId, setActivePanelId] = React.useState<string | null>(readRailActive);
  const [railCollapsed, setRailCollapsed] = React.useState<boolean>(readRailCollapsed);

  const activePanel =
    panels.find((panel) => panel.id === activePanelId) ??
    panels.find((panel) => panel.id === aside?.defaultPanelId) ??
    panels[0] ??
    null;
  const activePanelIdResolved = activePanel?.id ?? '';

  // Click a panel icon: collapse if it is the already-active, visible panel; otherwise switch to it
  // and expand. Only explicit clicks persist, so passive resolution never overwrites a real choice.
  //
  // Below the dock threshold the bar drives the *overlay* instead, so the identical affordance never
  // takes width away from `<main>` at the sizes where `<main>` cannot spare any.
  const handlePanelIconClick = React.useCallback(
    (id: string) => {
      if (!canDockRail) {
        const closing = id === activePanelIdResolved && overlayPanelOpen;
        setActivePanelId(id);
        writeRailState(RAIL_ACTIVE_KEY, id);
        setOverlayPanelOpen(!closing);
        return;
      }
      if (id === activePanelIdResolved && !railCollapsed) {
        setRailCollapsed(true);
        writeRailState(RAIL_COLLAPSED_KEY, '1');
        return;
      }
      setActivePanelId(id);
      setRailCollapsed(false);
      writeRailState(RAIL_ACTIVE_KEY, id);
      writeRailState(RAIL_COLLAPSED_KEY, '0');
    },
    [activePanelIdResolved, canDockRail, overlayPanelOpen, railCollapsed],
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
            aria-controls={SHELL_ASIDE_ID}
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
          <ShellDrawerProvider dismiss={closeDrawer}>{sidebar}</ShellDrawerProvider>
        </SheetContent>
      </Sheet>

      {/* Static desktop rail — the canvas-blended sidebar, shown at `lg` and up. */}
      <div className="hidden lg:block">
        <ShellDrawerProvider dismiss={null}>{sidebar}</ShellDrawerProvider>
      </div>

      {/*
        The content column stacks the optional tab strip over the main panel. A column gap floats
        a real gutter BETWEEN the two so the detached tab pills read as their own layer on the
        canvas rather than fusing to the rounded panel below — the gap only materialises between
        siblings, so it costs nothing when no tab bar is present. Mobile stays full-bleed (no gap)
        so the panel uses the entire width; the gutter appears at `lg` to match the shell rhythm.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:gap-2">
        {tabBar}
        {banner}
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
            'bg-surface @container min-h-0 flex-1 scrollbar-gutter-stable overflow-auto pb-[env(safe-area-inset-bottom)] outline-none lg:rounded-xl',
            rebinding && 'animate-org-rebind',
          )}
        >
          {children}
        </main>
      </div>

      {/* Right-hand rail: the panel host docks only above {@link RAIL_DOCK_QUERY}; the activity bar
          is present from `lg` either way, so the affordance does not move when the panel changes
          from a docked sibling to an overlay. */}
      {activePanel && canDockRail ? (
        <ShellAside panel={activePanel} collapsed={railCollapsed} />
      ) : null}
      {activePanel && isLgUp ? (
        <ShellActivityBar
          panels={panels}
          activeId={activePanelIdResolved}
          collapsed={canDockRail ? railCollapsed : !overlayPanelOpen}
          onIconClick={handlePanelIconClick}
        />
      ) : null}

      {/* The same panels as a right-anchored modal Sheet whenever the rail cannot dock — opened from
          the mobile top-bar trigger below `lg`, and from the activity bar above it. Mutually
          exclusive with the inline host (the `canDockRail` gate), so the shared id stays unique. A
          compact horizontal switcher stands in for the activity bar on mobile, where there is none.
          Escape/backdrop dismiss closes it. */}
      <Sheet
        open={activePanel != null && !canDockRail && overlayPanelOpen}
        onOpenChange={(next) => {
          if (!next) setOverlayPanelOpen(false);
        }}
      >
        <SheetContent
          side="right"
          id={SHELL_ASIDE_ID}
          aria-label={activePanel?.label}
          aria-describedby={undefined}
          className="@container flex w-[22rem] max-w-[90vw] flex-col overflow-hidden"
        >
          <SheetTitle className="sr-only">{activePanel?.label}</SheetTitle>
          {panels.length > 1 && !isLgUp ? (
            <div role="tablist" aria-label="Panels" className="flex shrink-0 gap-1 px-2 pb-2">
              {panels.map((panel) => {
                const isActive = panel.id === activePanelIdResolved;
                return (
                  <button
                    key={panel.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setActivePanelId(panel.id);
                      writeRailState(RAIL_ACTIVE_KEY, panel.id);
                    }}
                    className={cn(
                      'focus-visible:ring-ring flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-4',
                      isActive
                        ? 'bg-surface-container-highest text-on-surface'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    {panel.icon}
                    {panel.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">{activePanel?.node}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
