'use client';

/**
 * Commands the page on screen offers through the command palette.
 *
 * @remarks
 * A page publishes its own actions (a task page's "Add blocker", "Add subtask") while it is
 * mounted, and the palette lists them first, under the page's own heading. One page publishes at a
 * time: the most recent publisher wins, and unmounting withdraws its commands. The store lives at
 * module scope because the palette and the page sit in unrelated parts of the tree.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { filterCommands } from './filter';
import type { PaletteItem } from './types';

/** What a page publishes: a heading for the palette section, and its commands. */
export interface PageCommands {
  /** The section heading, naming the thing the commands act on (e.g. "This task"). */
  readonly label: string;
  /** The commands; each must use the `page` section. */
  readonly items: readonly PaletteItem[];
}

const NONE: PageCommands = { label: '', items: [] };

let current: PageCommands = NONE;
const listeners = new Set<() => void>();

function publish(next: PageCommands): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Offer `commands` in the palette while the calling component is mounted.
 *
 * @param commands - The heading and commands; pass a stable (memoized) value.
 */
export function usePublishPageCommands(commands: PageCommands): void {
  useEffect(() => {
    publish(commands);
    return () => {
      if (current === commands) publish(NONE);
    };
  }, [commands]);
}

/**
 * Read the commands the page on screen offers.
 *
 * @returns the published heading and commands; empty when no page publishes any.
 */
export function usePageCommands(): PageCommands {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
}

/**
 * Read the page's commands that match what the palette's box holds.
 *
 * @param query - The palette's text.
 * @param enabled - Whether the palette lists commands at all (a prefix mode shows its own rows).
 * @returns the heading and the matching commands, in published order.
 */
export function usePageCommandMatches(query: string, enabled: boolean): PageCommands {
  const published = usePageCommands();
  return useMemo(
    () => ({
      label: published.label,
      items: enabled ? filterCommands(published.items, query) : [],
    }),
    [enabled, published, query],
  );
}
