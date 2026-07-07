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
 */
import * as React from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ChevronLeft, Menu } from '../../icons';
import { cn } from '../../lib/utils';
import { Sheet, SheetContent, SheetTitle } from '../../primitives';
import { useContextState } from './ContextProvider';
import { SHELL_ASIDE_ID, ShellAside, type ShellAsidePanel } from './ShellAside';
import { ShellDrawerProvider } from './ShellDrawerContext';

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
   * The optional right-hand **rail** — a floating sibling surface to the main panel (like
   * {@link sidebar}, a host-wired slot, not page content). Shown by default on `lg` and up
   * (collapsible to a strip); below `lg` it's a right-anchored {@link Sheet} opened from the mobile
   * top bar. Omit it and no rail renders.
   */
  aside?: ShellAsidePanel;
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
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // Two states because the two rail presentations have opposite defaults and different interactions:
  // the desktop rail is a collapsible inline surface (shown by default), the mobile sheet is a modal
  // (hidden by default, opened from the top-bar trigger).
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = React.useState(false);

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
    prevOrgIdRef.current = activeOrgId;
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
        'bg-surface-container text-on-surface flex h-screen w-full flex-col overflow-hidden lg:flex-row lg:gap-2 lg:p-2',
        className,
      )}
    >
      {/* Skip-to-content — the first focusable element, visually hidden until focused. Lets a
          keyboard user jump past the workspace switcher + full nav + open document tabs straight
          to the page content (the `<main>` region below is a focus target via `tabIndex={-1}`). */}
      <a
        href="#main-content"
        className="bg-surface text-on-surface border-outline-variant focus-visible:ring-ring text-body sr-only z-50 rounded-md border px-3 py-2 font-medium shadow-sm transition-colors focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        Skip to content
      </a>

      {/* Mobile top bar — shown only below `lg`; opens the sidebar drawer. */}
      <div className="border-outline-variant flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
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
          {mobileBrand ?? <span className="text-body truncate font-semibold">Docket</span>}
        </div>
        {mobileActions}
        {/* Mobile rail trigger — opens the rail slot as a right sheet. Uses the slot's glyph
            (falling back to a chevron). */}
        {aside ? (
          <button
            type="button"
            aria-label={`Show ${aside.label}`}
            aria-controls={SHELL_ASIDE_ID}
            aria-expanded={mobileSheetOpen}
            onClick={() => {
              setMobileSheetOpen(true);
            }}
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-5"
          >
            {aside.icon ?? <ChevronLeft aria-hidden="true" className="size-5" />}
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
            'bg-surface lg:border-outline-variant @container min-h-0 flex-1 scrollbar-gutter-stable overflow-auto outline-none lg:rounded-xl lg:border lg:shadow-sm',
            rebinding && 'animate-org-rebind',
          )}
        >
          {children}
        </main>
      </div>

      {/* Right-hand rail (desktop): a floating sibling surface to the main panel, shown by default
          at `lg` and up and collapsible to a strip. */}
      {aside && isLgUp ? (
        <ShellAside
          panel={aside}
          collapsed={railCollapsed}
          onToggle={() => {
            setRailCollapsed((c) => !c);
          }}
        />
      ) : null}

      {/* The same rail slot as a right-anchored modal Sheet below `lg`, opened from the top-bar
          trigger. Mutually exclusive with the inline rail (the `isLgUp` gate), so the shared id stays
          unique and the slot mounts in exactly one place. Escape/backdrop dismiss closes it. */}
      <Sheet
        open={aside != null && !isLgUp && mobileSheetOpen}
        onOpenChange={(next) => {
          if (!next) setMobileSheetOpen(false);
        }}
      >
        <SheetContent
          side="right"
          id={SHELL_ASIDE_ID}
          aria-label={aside?.label}
          aria-describedby={undefined}
          className="@container w-[22rem] max-w-[90vw] overflow-auto lg:hidden"
        >
          <SheetTitle className="sr-only">{aside?.label}</SheetTitle>
          {aside?.node}
        </SheetContent>
      </Sheet>
    </div>
  );
}
