'use client';

import { Command, Search } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { useCommandPalette } from './command-palette-provider';

/** Props for {@link CommandPaletteTrigger}. */
export interface CommandPaletteTriggerProps {
  /** Extra classes for the trigger (e.g. width constraints from the host header). */
  className?: string;
}

/**
 * A visible search-box trigger that opens the command palette.
 *
 * @remarks
 * Styled like a quiet search field — a leading magnifier, the "Search…" affordance, and a
 * trailing `⌘K` shortcut hint — but it is a single button (it does not capture text itself;
 * clicking opens the full {@link CommandPalette}). Provided for app headers/toolbars that want
 * an always-visible entry point in addition to the rail's Search rail entry and the global
 * Cmd/Ctrl+K shortcut.
 */
export function CommandPaletteTrigger({ className }: CommandPaletteTriggerProps): JSX.Element {
  const { openPalette } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-keyshortcuts="Meta+K Control+K"
      aria-label="Open command palette"
      className={cn(
        'border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring text-body flex h-9 items-center gap-2 rounded-md border bg-transparent px-3 shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none',
        className,
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="bg-surface-container text-on-surface-variant pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border px-1.5 text-[10px] font-medium">
        <Command aria-hidden="true" className="size-3" />K
      </kbd>
    </button>
  );
}
