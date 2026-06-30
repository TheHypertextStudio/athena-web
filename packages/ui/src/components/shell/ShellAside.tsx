'use client';

/**
 * `@docket/ui` — the desktop rail chrome for the shell's right-hand aside.
 *
 * @remarks
 * A single animated flex item — one panel whose width transitions between a thin collapsed strip and
 * the full rail — so the `flex-1` main panel reflows in one continuous motion. Nothing mounts/unmounts
 * in the flex flow on toggle: the reopen control is an **absolute overlay** over the collapsed strip,
 * so there is no one-frame layout jump at the main panel's edge. The panel chrome (surface, border,
 * shadow) lives on the animating wrapper so it reads identically open and collapsed; the inner content
 * keeps a fixed width and is clipped, so it never reflows mid-animation.
 *
 * The content + label/glyph come from {@link AppShellProps.aside} as a plain slot; the collapse state
 * is shell-owned and passed in. {@link AppShell} renders this only on `lg` and up; below `lg` the same
 * slot is presented by the shell's right {@link Sheet}.
 */
import * as React from 'react';

import { ChevronLeft, ChevronRight } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, Row, Stack } from '../../primitives';

/** Stable id for the rail, referenced by the collapse/reopen controls' `aria-controls`. */
export const SHELL_ASIDE_ID = 'shell-aside';

/** A right-rail panel: its content plus the label/glyph the rail chrome needs. */
export interface ShellAsidePanel {
  /** The rail body (e.g. the agenda). */
  readonly node: React.ReactNode;
  /** Accessible name shown in the rail header + on the collapse/reopen controls. */
  readonly label: string;
  /** Optional glyph for the reopen control (and the mobile trigger); falls back to a chevron. */
  readonly icon?: React.ReactNode;
}

/** Props for {@link ShellAside}. */
export interface ShellAsideProps {
  /** The panel to render. */
  readonly panel: ShellAsidePanel;
  /** Whether the rail is collapsed to its strip. */
  readonly collapsed: boolean;
  /** Toggle the collapsed state. */
  readonly onToggle: () => void;
}

/** The desktop rail: an animated panel with a collapse header and a reopen overlay when collapsed. */
export function ShellAside({ panel, collapsed, onToggle }: ShellAsideProps): React.JSX.Element {
  const open = !collapsed;
  return (
    <div
      className={cn(
        // The panel chrome lives here so it's identical open vs collapsed; width is the only thing
        // that animates, and it's the sole flex item, so the main panel reflows smoothly. `ease-in-out`
        // (the gentler symmetric curve) rather than the default snappy decelerate, since the rail
        // slides both open and closed.
        'bg-surface border-outline-variant @container relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border shadow-sm transition-[width] duration-(--dur-slow) ease-in-out',
        open ? 'w-[22rem]' : 'w-12',
      )}
    >
      {/* Full content, fixed-width so it never reflows as the wrapper clips it. `inert` while
          collapsed keeps the clipped controls out of the tab order (the overlay handles reopen). */}
      <Stack
        as="aside"
        id={SHELL_ASIDE_ID}
        aria-label={panel.label}
        inert={open ? undefined : true}
        className="h-full w-[22rem] min-h-0"
      >
        <Row
          as="header"
          justify="between"
          className="border-outline-variant h-11 shrink-0 border-b pr-2 pl-3"
        >
          <span className="text-on-surface truncate text-sm font-semibold">{panel.label}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={SHELL_ASIDE_ID}
            aria-label={`Collapse ${panel.label}`}
            title={`Collapse ${panel.label}`}
            className="text-on-surface-variant shrink-0"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </Row>
        <div className="min-h-0 flex-1 overflow-hidden">{panel.node}</div>
      </Stack>

      {/* Reopen overlay — covers the thin collapsed strip (absolute, so toggling it shifts no
          layout). Fills the strip so the whole collapsed rail is the click target. */}
      {open ? null : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={SHELL_ASIDE_ID}
          aria-label={`Show ${panel.label}`}
          title={`Show ${panel.label}`}
          className="bg-surface text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring absolute inset-0 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-5"
        >
          {panel.icon ?? <ChevronLeft aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
