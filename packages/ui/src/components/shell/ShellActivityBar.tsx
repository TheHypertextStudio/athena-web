'use client';

/**
 * `@docket/ui` — the thin, always-visible activity bar on the far right edge of the shell.
 *
 * @remarks
 * A VS Code / Sunsama-style icon rail that switches which supplemental panel the {@link ShellAside}
 * host shows. It is **always visible** (even when the panel host is collapsed), so it doubles as the
 * peek/reopen affordance: click a non-active icon to switch to that panel (expanding the host if
 * collapsed); click the active icon to collapse the host. Canvas-blended (no panel chrome) like the
 * left {@link Sidebar}, so it reads as part of the shell frame rather than a separate container.
 *
 * The panel set is **internal-only** — a curated list of Docket-native panels supplied by the host
 * app — never an exhaustive gallery of third-party integration add-ons.
 *
 * @remarks **Layout contract.** The bar is a fixed 3rem column, hidden below `lg` **in CSS** (below
 * it the panels are reached from the mobile top bar instead). Fixed and always-present is the point:
 * it is the only part of the rail that costs `<main>` width unconditionally, and a *constant* cost
 * makes `<main>`'s share of the viewport strictly increase as the window widens. A bar that appeared
 * at a threshold, or grew with the viewport, would put a step or a slope into that curve.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { SHELL_ASIDE_ID, type RailPanel } from './ShellAside';

/** Props for {@link ShellActivityBar}. */
export interface ShellActivityBarProps {
  /** The ordered panels to expose as icons. */
  readonly panels: readonly RailPanel[];
  /** The id of the active panel (highlighted when the host is expanded). */
  readonly activeId: string;
  /** Whether the panel host is currently collapsed. */
  readonly collapsed: boolean;
  /** Click a panel icon: switch to it (expanding), or collapse if it is already the active panel. */
  readonly onIconClick: (id: string) => void;
}

/** The far-right icon rail that switches supplemental panels and toggles the host collapse. */
export function ShellActivityBar({
  panels,
  activeId,
  collapsed,
  onIconClick,
}: ShellActivityBarProps): React.JSX.Element {
  return (
    <nav
      aria-label="Panels"
      className="hidden h-full w-12 shrink-0 flex-col items-center gap-1 py-2 lg:flex"
    >
      {panels.map((panel) => {
        const isActive = panel.id === activeId;
        // Filled highlight only when this panel is both selected AND visible; while collapsed every
        // icon reads as "click to open" rather than one looking active over a hidden panel.
        const showsActive = isActive && !collapsed;
        const name = showsActive ? `Collapse ${panel.label}` : panel.label;
        return (
          <button
            key={panel.id}
            type="button"
            // The status rides in the accessible name rather than in a live region inside the
            // button: `aria-label` wins over a button's contents, so anything rendered in there
            // would be announced to nobody.
            aria-label={panel.status ? `${name}, ${panel.status.label}` : name}
            aria-pressed={isActive}
            aria-controls={SHELL_ASIDE_ID}
            title={panel.status ? `${panel.label} — ${panel.status.label}` : panel.label}
            onClick={() => {
              onIconClick(panel.id);
            }}
            className={cn(
              'focus-visible:ring-ring relative flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-6',
              showsActive
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            )}
          >
            {panel.icon}
            {/* Positioned absolutely inside the existing size-10 box so the bar stays exactly
                w-12 whatever a panel reports — the shell's fixed chrome width is a layout
                invariant, not a coincidence. The name above carries this for a screen reader. */}
            {panel.status ? (
              <span
                aria-hidden="true"
                data-testid={`rail-status-${panel.id}`}
                data-tone={panel.status.tone}
                className={cn(
                  'ring-surface absolute top-1 right-1 size-2 rounded-full ring-2',
                  panel.status.tone === 'active' && 'bg-state-started',
                  panel.status.tone === 'muted' && 'bg-on-surface-variant',
                  panel.status.tone === 'attention' && 'bg-primary motion-safe:animate-pulse',
                )}
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
