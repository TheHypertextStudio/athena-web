import '@testing-library/jest-dom/vitest';

/**
 * The shell's **layout contract**: what `<main>` is worth at any window width.
 *
 * @remarks
 * The bug this file exists to keep dead: the rail used to be a fixed 22rem column that *appeared*
 * at a media query, so crossing that query took ~400px out of `<main>` in a single pixel of window
 * growth. Measured in a real browser on the running app: `<main>` was 1119px wide at a 1439px
 * viewport and 760px at 1440px — **the window got wider and the content got smaller**.
 *
 * The rail's inline size is now a *person-chosen* pixel width (see the width law on `ShellAside`),
 * not a function of the viewport at all, so the arithmetic below no longer parses a CSS expression
 * off the rendered rail — there is none to parse. It instead cross-checks `shellMainInlineSize`
 * (the exported contract) against the same pure width function the rail itself renders from
 * (`railClampWidthPx`), while independently reading the *unrelated* constant chrome — the sidebar
 * column, the activity bar column, the shell's padding and gaps — straight out of the DOM the
 * components actually render. If anyone changes one of those unrelated widths, the parsed input
 * changes and the guarantees below are re-checked against it.
 *
 * jsdom has no layout engine and reports one fixed `window.innerWidth`, so the sweep across 320px
 * to 3840px below is arithmetic, not a live resize. The pixel side of the proof is a browser probe
 * over the running app (`apps/web/.data/design-review/probe-shell-sweep.ts`).
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Home } from '../../../src/icons';
import {
  AppShell,
  SHELL_DESKTOP_CHROME_COLLAPSED_PX,
  SHELL_DESKTOP_CHROME_PX,
  SHELL_DESKTOP_MIN_PX,
  SHELL_MAIN_MIN_VIEWPORT_SHARE,
  shellMainInlineSize,
} from '../../../src/components/shell/AppShell';
import { RAIL_GAP_PX, railClampWidthPx } from '../../../src/components/shell/ShellAside';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';
import { assertDefined } from '@docket/test-utils';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };

/** Tailwind's spacing scale in px (`--spacing: 0.25rem`), e.g. `w-12` → 48, `p-2` → 8. */
function spacingPx(step: number): number {
  return step * 4;
}

/** The px value of a `w-<n>` / `lg:w-<n>` utility on an element, or `null` when it carries none. */
function columnWidthPx(element: Element, prefix: string): number | null {
  const match = new RegExp(`(?:^| )${prefix}w-(\\d+)(?: |$)`).exec(element.className);
  return match?.[1] === undefined ? null : spacingPx(Number(match[1]));
}

const PANEL = { id: 'tasks', label: 'Tasks', icon: <Home />, node: <div>Task list</div> };

/**
 * Every shell state each guarantee is checked in.
 *
 * @remarks
 * Both columns are independently collapsible, so the contract has four arrangements to hold in, not
 * two. The binding one for the floor is "everything open" — that is the arrangement an untouched
 * shell produces on a wide window, so the floor proven below is the one people actually get.
 */
const SHELL_STATES = [
  { label: 'rail collapsed, sidebar expanded', expanded: false, sidebarCollapsed: false },
  { label: 'rail expanded, sidebar expanded', expanded: true, sidebarCollapsed: false },
  { label: 'rail collapsed, sidebar collapsed', expanded: false, sidebarCollapsed: true },
  { label: 'rail expanded, sidebar collapsed', expanded: true, sidebarCollapsed: true },
] as const;

/**
 * Render the shell with a rail, open, so its constant chrome can be read off the DOM.
 *
 * @remarks
 * Open is also the default, so this is the arrangement an untouched shell produces — the floor
 * proven below is therefore unconditional, not contingent on the viewer closing the panel. The flag
 * is written explicitly (the same `'0'` the shell persists on expand) so the test states the state
 * it depends on rather than inheriting it.
 *
 * The sidebar is pinned expanded for the same reason, and one more: it auto-collapses below
 * {@link SHELL_SIDEBAR_EXPAND_MIN_PX}, and jsdom reports a 1024px window — so without this the
 * geometry read below would measure the *collapsed* column and every arithmetic check would be
 * against a chrome width the contract does not advertise.
 */
function renderShell(sidebarCollapsed = false): void {
  window.localStorage.setItem('docket.rail.collapsed', '0');
  window.localStorage.setItem('docket.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
  render(
    <ContextProvider initialContext={ACME.id}>
      <AppShell
        sidebar={
          <Sidebar
            workspaces={[ACME]}
            hrefForHome={(key) => `/${key}`}
            hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
            renderLink={(href, content) => <a href={href}>{content}</a>}
            onSelectWorkspace={() => undefined}
            onCreateWorkspace={() => undefined}
            onOpenSearch={() => undefined}
          />
        }
        aside={{ panels: [PANEL], defaultPanelId: 'tasks' }}
      >
        <div>Main</div>
      </AppShell>
    </ContextProvider>,
  );
}

/** The complete horizontal region consumed before collapsed navigation hands off to `<main>`. */
function collapsedNavigationRegionPx(): number {
  const main = screen.getByRole('main');
  const shell = main.closest('[data-density]');
  if (!shell) throw new Error('The shell root must carry data-density');

  const padding = /(?:^| )lg:p-(\d+)(?: |$)/.exec(shell.className);
  const gap = /(?:^| )lg:gap-(\d+)(?: |$)/.exec(shell.className);
  if (!padding?.[1] || !gap?.[1]) throw new Error('The shell root must declare lg padding and gap');

  const nav = screen.getByRole('complementary', { name: 'Navigation' });
  const navWidth = columnWidthPx(nav, 'lg:');
  if (navWidth === null) throw new Error('The collapsed navigation must declare a fixed width');

  return spacingPx(Number(padding[1])) + navWidth + spacingPx(Number(gap[1]));
}

/** The shell's measured constant chrome, read out of one render of the real components. */
interface ShellGeometry {
  readonly chromePx: number;
}

/**
 * Read the shell's constant chrome out of the rendered DOM — everything *except* the rail, whose
 * own width law is a pure function ({@link railClampWidthPx}) rather than a class to parse.
 *
 * @remarks
 * Counts the desktop columns the same way the browser does — a child hidden at `lg` (`lg:hidden`)
 * or taken out of flow (`sr-only`, absolutely positioned) is neither a column nor a source of a gap.
 */
function readGeometry(): ShellGeometry {
  const main = screen.getByRole('main');
  const shell = main.closest('[data-density]');
  if (!shell) throw new Error('The shell root must carry data-density');

  const desktopColumns = [...shell.children].filter(
    (child) => !child.className.includes('lg:hidden') && !child.className.includes('sr-only'),
  );
  const padding = /(?:^| )lg:p-(\d+)(?: |$)/.exec(shell.className);
  const gap = /(?:^| )lg:gap-(\d+)(?: |$)/.exec(shell.className);
  if (!padding?.[1] || !gap?.[1]) throw new Error('The shell root must declare lg padding and gap');

  const nav = screen.getByRole('complementary', { name: 'Navigation' });
  const bar = screen.getByRole('navigation', { name: 'Panels' });
  const navWidth = columnWidthPx(nav, 'lg:');
  const barWidth = columnWidthPx(bar, '');
  const dockRow = bar.parentElement;
  const dockGap = dockRow ? /(?:^| )gap-(\d+)(?: |$)/.exec(dockRow.className) : null;
  if (navWidth === null || barWidth === null) {
    throw new Error('The sidebar and the activity bar must each declare a fixed column width');
  }

  return {
    chromePx:
      spacingPx(Number(padding[1])) * 2 +
      spacingPx(Number(gap[1])) * (desktopColumns.length - 1) +
      (dockGap?.[1] === undefined ? 0 : spacingPx(Number(dockGap[1]))) +
      navWidth +
      barWidth,
  };
}

/** `<main>`'s width at a viewport, from the geometry the components actually rendered. */
function mainWidth(
  geometry: ShellGeometry,
  viewport: number,
  railExpanded: boolean,
  sidebarCollapsed = false,
): number {
  if (viewport < SHELL_DESKTOP_MIN_PX) return viewport;
  const rail = railExpanded ? railClampWidthPx(viewport) + RAIL_GAP_PX : 0;
  // Collapsing the sidebar swaps one column's width for another; it adds no column and removes
  // none, so the gutters and the activity bar in `chromePx` are unchanged.
  const chrome = sidebarCollapsed
    ? geometry.chromePx - (SHELL_DESKTOP_CHROME_PX - SHELL_DESKTOP_CHROME_COLLAPSED_PX)
    : geometry.chromePx;
  return viewport - chrome - rail;
}

/** Every integer width in the desktop regime, plus the compact regime, up to a 4K window. */
const DESKTOP_WIDTHS = Array.from(
  { length: 3840 - SHELL_DESKTOP_MIN_PX + 1 },
  (_, i) => SHELL_DESKTOP_MIN_PX + i,
);
const COMPACT_WIDTHS = Array.from({ length: SHELL_DESKTOP_MIN_PX - 320 }, (_, i) => 320 + i);

describe('AppShell layout contract — geometry read from the rendered shell', () => {
  it('keeps the entire collapsed navigation region within the 80px MD3 rail width', () => {
    renderShell(true);

    expect(collapsedNavigationRegionPx()).toBe(80);
  });

  it('renders the rail at its default fixed width, not a viewport share, and every other column as a constant', () => {
    renderShell();
    const geometry = readGeometry();

    // The constant chrome is what the exported contract advertises; drift here changes the floor.
    expect(geometry.chromePx).toBe(SHELL_DESKTOP_CHROME_PX);

    // The rail renders at exactly what its own pure width function says for jsdom's viewport — a
    // person-chosen pixel width, not a CSS expression of the viewport.
    const aside = screen.getByRole('complementary', { name: 'Tasks' });
    expect(aside).toHaveStyle({ width: `${String(railClampWidthPx(window.innerWidth))}px` });
    expect(aside).toHaveClass('mr-2');
  });

  it('agrees with the exported contract at every width, in every shell state', () => {
    renderShell();
    const geometry = readGeometry();

    for (const viewport of [...COMPACT_WIDTHS, ...DESKTOP_WIDTHS]) {
      for (const { expanded, sidebarCollapsed } of SHELL_STATES) {
        expect(shellMainInlineSize(viewport, expanded, sidebarCollapsed)).toBeCloseTo(
          mainWidth(geometry, viewport, expanded, sidebarCollapsed),
          6,
        );
      }
    }
  });
});

describe('AppShell layout contract — <main> keeps its floor, and widening never costs it', () => {
  for (const { label, expanded, sidebarCollapsed } of SHELL_STATES) {
    it(`never drops <main> below its guaranteed share with the ${label}`, () => {
      renderShell();
      const geometry = readGeometry();

      let worst = { viewport: 0, share: Number.POSITIVE_INFINITY };
      for (const viewport of [...COMPACT_WIDTHS, ...DESKTOP_WIDTHS]) {
        const share = mainWidth(geometry, viewport, expanded, sidebarCollapsed) / viewport;
        if (share < worst.share) worst = { viewport, share };
      }
      expect(
        worst.share,
        `<main> fell to ${(worst.share * 100).toFixed(2)}% of a ${String(worst.viewport)}px viewport`,
      ).toBeGreaterThanOrEqual(SHELL_MAIN_MIN_VIEWPORT_SHARE);
    });

    it(`never narrows <main> as the window widens, with the ${label}`, () => {
      renderShell();
      const geometry = readGeometry();

      // Checked within each regime. The 1023→1024 step, where the nav stops being a drawer and
      // becomes a column, is the shell's one deliberate discontinuity: below it `<main>` already
      // holds the entire viewport, and no breakpoint exists at which one more pixel of window pays
      // for a 288px navigation column.
      for (const widths of [COMPACT_WIDTHS, DESKTOP_WIDTHS]) {
        for (let i = 1; i < widths.length; i += 1) {
          const previous = assertDefined(widths[i - 1]);
          const current = assertDefined(widths[i]);
          const before = mainWidth(geometry, previous, expanded, sidebarCollapsed);
          const after = mainWidth(geometry, current, expanded, sidebarCollapsed);
          expect(
            after,
            `<main> shrank from ${String(previous)}px to ${String(current)}px`,
          ).toBeGreaterThanOrEqual(before);
          expect(
            after / current,
            `<main>'s share fell from ${String(previous)}px to ${String(current)}px`,
          ).toBeGreaterThanOrEqual(before / previous - 1e-9);
        }
      }
    });
  }

  it('gives the rail no width at all below the desktop breakpoint', () => {
    renderShell();
    const geometry = readGeometry();

    // Below `lg` the panels are a modal sheet, so an open rail costs `<main>` nothing — the two
    // states are identical and `<main>` is the whole window.
    for (const viewport of COMPACT_WIDTHS) {
      expect(mainWidth(geometry, viewport, true)).toBe(viewport);
      expect(mainWidth(geometry, viewport, false)).toBe(viewport);
    }
  });

  it('keeps expanding the rail from ever costing <main> more than it gains from a wider window', () => {
    renderShell();
    const geometry = readGeometry();

    // The rail's marginal cost per pixel of window growth must never be negative, or a wider
    // window would hand `<main>` less than it took. The rail's default width is fixed once the
    // window is wide enough to fit it without the half-viewport clamp binding, so growth beyond
    // that point costs `<main>` nothing at all — this is the property the old fixed-width-that-
    // appears-at-a-threshold rail broke.
    for (const viewport of DESKTOP_WIDTHS.slice(1)) {
      const gained = mainWidth(geometry, viewport, true) - mainWidth(geometry, viewport - 1, true);
      expect(gained).toBeGreaterThanOrEqual(0);
      expect(gained).toBeLessThanOrEqual(1);
    }
  });
});
