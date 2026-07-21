'use client';

/**
 * `@docket/ui` — the desktop **panel host** for the shell's right-hand rail.
 *
 * @remarks
 * The right rail is a Sunsama-style pair: a thin, always-visible {@link ShellActivityBar} on the far
 * edge that switches which supplemental panel is active, plus this wider **panel host** beside it that
 * renders the active panel. The host is a single width-animated surface — expanded it is the full rail,
 * collapsed it animates to zero width — so the `flex-1` main panel reflows in one continuous motion.
 * The activity bar stays put and is the peek/reopen affordance, so the host needs no collapse chrome
 * of its own.
 *
 * Each panel owns its **own** header (the Agenda its day navigator, the Tasks panel its day + progress
 * header), so the host renders no title row — that avoids the double-header the old single-panel rail
 * had. Which panel is active, and the collapsed state, are shell-owned and passed in; {@link AppShell}
 * renders this only on `lg` and up. Below `lg` the same panels are presented by the shell's right
 * {@link Sheet}. The activity bar is deliberately **internal-only** — a curated set of Docket-native
 * panels, never a gallery of third-party integration add-ons.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** Stable id for the panel host, referenced by the activity bar / mobile trigger `aria-controls`. */
export const SHELL_ASIDE_ID = 'shell-aside';

/** One supplemental panel the rail can show: its content plus the activity-bar switcher metadata. */
export interface RailPanel {
  /** Stable id (also the persisted "active panel" key). */
  readonly id: string;
  /** Accessible name — the activity-bar button label + the host landmark label. */
  readonly label: string;
  /** The activity-bar glyph (and the mobile trigger icon when active). */
  readonly icon: React.ReactNode;
  /** The panel body (owns its own header). */
  readonly node: React.ReactNode;
}

/** The right rail: the ordered set of native panels plus the one shown by default. */
export interface AppShellAside {
  /** The curated, Docket-native panels (e.g. Tasks, Agenda) — never an integration add-on list. */
  readonly panels: readonly RailPanel[];
  /** Which panel is active until the user picks another (falls back to the first). */
  readonly defaultPanelId?: string;
}

/** Props for {@link ShellAside}. */
export interface ShellAsideProps {
  /** The currently active panel to render. */
  readonly panel: RailPanel;
  /** Whether the host is collapsed to zero width (the activity bar stays visible). */
  readonly collapsed: boolean;
}

/** The desktop panel host: a width-animated surface rendering the active panel; the bar handles toggling. */
export function ShellAside({ panel, collapsed }: ShellAsideProps): React.JSX.Element {
  const open = !collapsed;
  return (
    <aside
      id={SHELL_ASIDE_ID}
      aria-label={panel.label}
      inert={open ? undefined : true}
      className={cn(
        // Tonal surface (no border — the surface step off the canvas carries the separation); width is
        // the only animated property, and it's a flex sibling of `<main>`, so the panel reflows in one
        // continuous motion. Collapsed → zero width; the always-visible activity bar is the reopen.
        'bg-surface @container h-full min-h-0 shrink-0 overflow-hidden rounded-xl shadow-sm transition-[width] duration-(--dur-slow) ease-in-out',
        open ? 'w-[22rem]' : 'w-0',
      )}
    >
      {/* Fixed-width inner so the content never reflows while the wrapper animates its width. */}
      <div className="h-full min-h-0 w-[22rem] overflow-hidden">{panel.node}</div>
    </aside>
  );
}
