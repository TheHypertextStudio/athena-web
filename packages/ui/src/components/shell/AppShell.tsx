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
 * {@link TabBar} sits in its **own bar on the canvas** above the main panel — its active tab
 * shares the panel's tone so the two read as one continuous surface.
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

import { Menu } from '../../icons';
import { cn } from '../../lib/utils';
import { Sheet, SheetContent, SheetTitle } from '../../primitives';
import { useContextState } from './ContextProvider';
import { ShellDrawerProvider } from './ShellDrawerContext';

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The single integrated navigation {@link Sidebar} (host-wired). */
  sidebar: React.ReactNode;
  /** The optional multi-document {@link TabBar}, rendered above the content. */
  tabBar?: React.ReactNode;
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
  /** Extra class names for the root shell element. */
  className?: string;
  /** The main-area content. */
  children: React.ReactNode;
}

/**
 * The Docket app shell: a responsive Sidebar + TabBar + main layout, with org-accent rebinding.
 *
 * @remarks
 * On context rebind the active org's accent is applied as `--org-accent` on the shell root
 * and `data-density` reflects the current density, so the bound org is visually unambiguous
 * throughout the subtree. The same `sidebar` node renders in two slots — the static desktop
 * rail (`lg` and up) and the mobile off-canvas drawer (below `lg`) — so the navigation stays
 * a single source of truth across breakpoints.
 */
export function AppShell({
  sidebar,
  tabBar,
  mobileBrand,
  mobileActions,
  className,
  children,
}: AppShellProps): React.JSX.Element {
  const { orgAccent, density } = useContextState();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Stable dismiss callback handed to the drawer-rendered sidebar so a nav selection closes the
  // drawer (the static desktop rail sits under a `null` provider, so it never closes anything).
  const closeDrawer = React.useCallback(() => {
    setDrawerOpen(false);
  }, []);

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
        className="bg-surface text-on-surface border-outline-variant focus-visible:ring-ring sr-only z-50 rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:ring-2 focus-visible:outline-none"
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
          className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center">
          {mobileBrand ?? <span className="truncate text-sm font-semibold">Docket</span>}
        </div>
        {mobileActions}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabBar}
        <main
          id="main-content"
          tabIndex={-1}
          className="bg-surface lg:border-outline-variant @container min-h-0 flex-1 scrollbar-gutter-stable overflow-auto outline-none lg:rounded-xl lg:border lg:shadow-sm"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
