import '@testing-library/jest-dom/vitest';

/**
 * The shell's **layout contract**: what `<main>` is worth at any window width.
 *
 * @remarks
 * The bug this file exists to keep dead: the rail used to be a fixed 22rem column that *appeared*
 * at a media query, so crossing that query took ~400px out of `<main>` in a single pixel of window
 * growth. Measured in a real browser on the running app: `<main>` was 1119px wide at a 1439px
 * viewport and 760px at 1440px — **the window got wider and the content got smaller** — and at
 * 1024px a docked rail would have left the calendar under 10% of the screen.
 *
 * jsdom has no layout engine, so this file does not pretend to measure pixels. It does something a
 * pixel measurement cannot: it derives the shell's width arithmetic **from the classes the
 * components actually render** — the rail's width expression, the activity bar's column, the
 * sidebar's column, the shell's padding and gaps — and then evaluates `<main>`'s width at *every
 * integer viewport width from 320 to 3840*, which no browser sweep can afford. If anyone changes a
 * width in the shell (including the sidebar's, which this package owns but this file does not), the
 * parsed inputs change and the guarantees below are re-checked against them. If someone replaces the
 * rail's viewport-share expression with a fixed width, the parse fails outright.
 *
 * The pixel side of the proof is a browser probe over the running app
 * (`apps/web/.data/design-review/probe-shell-sweep.ts`), which drags a real window from 320px to
 * 2200px across 525 widths and confirms the CSS produces exactly what this arithmetic says.
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
import { RAIL_MIN_INLINE_SIZE_PX } from '../../../src/components/shell/ShellAside';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';

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

/**
 * The rail's width law, read back out of the class the component rendered.
 *
 * @remarks
 * Deliberately strict: it matches only a `clamp(<floor>rem, <share>vw, <cap>rem)` expression. A
 * plain `w-[22rem]` — the exact shape of the original bug — does not parse, and every guarantee
 * below fails loudly instead of silently checking a stale constant.
 *
 * The floor is part of the law rather than a detail of it. A share alone bottoms out at 174px on a
 * 1024px window, and the panels the rail hosts are unreadable there.
 */
function parseRailWidthLaw(className: string): {
  share: number;
  floorPx: number;
  capPx: number;
} {
  const match = /w-\[clamp\((\d+(?:\.\d+)?)rem,(\d+(?:\.\d+)?)vw,(\d+(?:\.\d+)?)rem\)\]/.exec(
    className,
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `The rail must size itself as a viewport share floored and capped in rem — got "${className}"`,
    );
  }
  return {
    floorPx: Number(match[1]) * 16,
    share: Number(match[2]) / 100,
    capPx: Number(match[3]) * 16,
  };
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
 * Render the shell with a rail, open, so its width law can be read off the DOM.
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
function renderShell(): void {
  window.localStorage.setItem('docket.rail.collapsed', '0');
  window.localStorage.setItem('docket.sidebar.collapsed', '0');
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

/** The shell's measured inputs, read out of one render of the real components. */
interface ShellGeometry {
  readonly chromePx: number;
  readonly railShare: number;
  readonly railFloorPx: number;
  readonly railCapPx: number;
}

/**
 * Read the shell's width arithmetic out of the rendered DOM.
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
  if (navWidth === null || barWidth === null) {
    throw new Error('The sidebar and the activity bar must each declare a fixed column width');
  }

  const rail = parseRailWidthLaw(screen.getByRole('complementary', { name: 'Tasks' }).className);
  return {
    chromePx:
      spacingPx(Number(padding[1])) * 2 +
      spacingPx(Number(gap[1])) * (desktopColumns.length - 1) +
      navWidth +
      barWidth,
    railShare: rail.share,
    railFloorPx: rail.floorPx,
    railCapPx: rail.capPx,
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
  const rail = railExpanded
    ? Math.min(Math.max(geometry.railShare * viewport, geometry.railFloorPx), geometry.railCapPx)
    : 0;
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
  it('sizes the rail as a viewport share, and every other column as a constant', () => {
    renderShell();
    const geometry = readGeometry();

    // A share strictly below 1 is what makes `<main>` gain from every pixel the window gains; a cap
    // is what hands the surplus back to `<main>` on very wide displays; a floor is what stops the
    // rail becoming too narrow to read at the bottom of the desktop range.
    expect(geometry.railShare).toBeGreaterThan(0);
    expect(geometry.railShare).toBeLessThan(1);
    expect(geometry.railCapPx).toBeGreaterThan(0);
    expect(geometry.railFloorPx).toBeGreaterThanOrEqual(RAIL_MIN_INLINE_SIZE_PX);
    expect(geometry.railFloorPx).toBeLessThanOrEqual(geometry.railCapPx);
    // The constant chrome is what the exported contract advertises; drift here changes the floor.
    expect(geometry.chromePx).toBe(SHELL_DESKTOP_CHROME_PX);
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
          const previous = widths[i - 1]!;
          const current = widths[i]!;
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

    // The rail's marginal cost per pixel of window growth must stay under 1, or a wider window
    // would hand `<main>` less than it took. This is the property the old fixed-width rail broke.
    for (const viewport of DESKTOP_WIDTHS.slice(1)) {
      const gained = mainWidth(geometry, viewport, true) - mainWidth(geometry, viewport - 1, true);
      expect(gained).toBeGreaterThan(0);
      expect(gained).toBeLessThanOrEqual(1);
    }
  });
});
