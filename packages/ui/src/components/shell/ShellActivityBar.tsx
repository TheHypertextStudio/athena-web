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
    <nav aria-label="Panels" className="flex h-full w-12 shrink-0 flex-col items-center gap-1 py-2">
      {panels.map((panel) => {
        const isActive = panel.id === activeId;
        // Filled highlight only when this panel is both selected AND visible; while collapsed every
        // icon reads as "click to open" rather than one looking active over a hidden panel.
        const showsActive = isActive && !collapsed;
        return (
          <button
            key={panel.id}
            type="button"
            aria-label={showsActive ? `Collapse ${panel.label}` : panel.label}
            aria-pressed={isActive}
            aria-controls={SHELL_ASIDE_ID}
            title={panel.label}
            onClick={() => {
              onIconClick(panel.id);
            }}
            className={cn(
              'focus-visible:ring-ring flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-6',
              showsActive
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            )}
          >
            {panel.icon}
          </button>
        );
      })}
    </nav>
  );
}
