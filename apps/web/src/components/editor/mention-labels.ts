'use client';

/**
 * The live-title registry every rendered `@mention` reads from.
 *
 * @remarks
 * A mention stores an id, so the title on screen has to come from somewhere else. This is that
 * somewhere: a tiny observable map from `kind:id` to the object's current title, written by
 * whoever last loaded the workspace's objects (see `mention-directory.ts`) and read by the
 * mention node view.
 *
 * It is module-level rather than React context because the reader is a ProseMirror node view —
 * a plain DOM node created outside the React tree, which cannot subscribe to a context. Keys are
 * globally unique (`kind` + ULID), so a single registry cannot confuse two workspaces.
 *
 * The registry is a *cache of titles*, never a source of truth: a mention whose object is not in
 * the registry falls back to the label stored with it, so an offline or not-yet-loaded document
 * still reads sensibly instead of showing an id or an empty chip.
 */

/** `kind:id` → the object's current title. */
const titles = new Map<string, string>();

/** Everyone currently rendering a mention. */
const listeners = new Set<() => void>();

/**
 * Publish the current titles for a set of objects.
 *
 * @remarks
 * Only notifies subscribers when something actually changed, so a list query re-resolving to the
 * same data does not re-render every mention in a long document.
 *
 * @param entries - `kind:id` → title pairs.
 */
export function publishMentionLabels(entries: Iterable<readonly [string, string]>): void {
  let changed = false;
  for (const [key, label] of entries) {
    if (titles.get(key) === label) continue;
    titles.set(key, label);
    changed = true;
  }
  if (!changed) return;
  for (const listener of listeners) listener();
}

/**
 * Read an object's current title.
 *
 * @param key - `kind:id`.
 * @returns The title, or `null` when this object has not been loaded.
 */
export function readMentionLabel(key: string): string | null {
  return titles.get(key) ?? null;
}

/**
 * Subscribe to title changes.
 *
 * @param listener - Called after any title changes.
 * @returns An unsubscribe function.
 */
export function subscribeMentionLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop every cached title. Test-only; the app never needs to forget a title. */
export function resetMentionLabels(): void {
  titles.clear();
}
