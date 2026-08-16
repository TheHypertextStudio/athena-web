'use client';

/**
 * `settings` — the sub-navigation for whichever section is open, read off the section itself.
 *
 * @remarks
 * The rail listed twenty-three sections and stopped. Inside one of them a reader faced anything up
 * to six groups with no map, so finding "Recovery codes" or "Calendar sharing" meant opening
 * Security or Calendar and scrolling until it appeared. The rail knew the sections; nothing knew
 * the sections' contents.
 *
 * ## Why this is derived rather than declared
 *
 * The obvious implementation is a list of group names per section in `settings-registry.ts`. That
 * is a second copy of something the page already states, and a second copy is a copy that goes
 * stale — the registry's own hand-maintained personal/shared split is exactly how Publishing came
 * to render on a workspace that has nothing to publish.
 *
 * So the outline is read from the rendered section: every {@link SettingsGroup} marks its heading,
 * and this collects those headings. A group added, renamed, reordered or conditionally hidden
 * changes the sub-nav in the same edit, because the sub-nav *is* the headings. A group that only
 * appears once its data loads appears in the outline at the same moment, which is what the
 * `MutationObserver` is for.
 *
 * The scroll spy is the other half of being scannable: knowing what a section contains is worth
 * less than knowing where in it you currently are.
 */
import { useEffect, useState } from 'react';

/** Marks a heading as one the outline should list. Set by {@link SettingsGroup}. */
export const SETTINGS_GROUP_ATTR = 'data-settings-group';

/** One entry in a section's outline. */
export interface SettingsOutlineEntry {
  /**
   * A key unique within this outline.
   *
   * @remarks
   * Not the heading's DOM id. A group title can be user-supplied — the Labels page renders one
   * group per label group the reader created — so two groups can slug to the same id, or to an
   * empty one if a name is all emoji. Position makes the key unique where the title cannot.
   */
  readonly key: string;
  /** The group's title, exactly as the section renders it. */
  readonly label: string;
  /**
   * The heading itself.
   *
   * @remarks
   * Held rather than re-found by id on every scroll frame and every click. It also sidesteps
   * duplicate ids entirely: `querySelector('#…')` returns the first match, so two groups sharing
   * a slug would scroll to the same place and the spy would highlight the wrong row.
   */
  readonly element: HTMLElement;
}

/**
 * A stable element id for a group heading.
 *
 * @remarks
 * Derived from the title so it survives a re-render and a remount — an index would renumber the
 * moment a conditional group appears above, silently moving every anchor below it.
 *
 * @param title - The group's title.
 * @returns a slug suitable for an element id.
 */
export function settingsGroupId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `settings-group-${slug}`;
}

/**
 * The group headings currently rendered inside a container.
 *
 * @param container - The section's scroll container, or null before it mounts.
 * @returns the outline, in document order; empty for a section with one group or none.
 */
export function useSettingsOutline(container: HTMLElement | null): readonly SettingsOutlineEntry[] {
  const [entries, setEntries] = useState<readonly SettingsOutlineEntry[]>([]);

  useEffect(() => {
    if (container === null) {
      setEntries([]);
      return;
    }

    const read = (): void => {
      const found = [...container.querySelectorAll(`[${SETTINGS_GROUP_ATTR}]`)].flatMap(
        (element, index) => {
          const label = element.textContent.trim();
          if (!(element instanceof HTMLElement) || !label) return [];
          return [{ key: `${String(index)}:${label}`, label, element }];
        },
      );
      // A one-group section has nothing to navigate between; an outline of one row is a control
      // that only ever points at what you are already looking at.
      const next = found.length > 1 ? found : [];
      setEntries((current) =>
        current.length === next.length &&
        current.every((entry, i) => {
          const candidate = next[i];
          return entry.key === candidate?.key && entry.element === candidate.element;
        })
          ? current
          : next,
      );
    };

    let frame = 0;
    const schedule = (): void => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          read();
        });
    };

    read();
    // `childList` alone: a group heading appears or disappears by mounting, never by having its
    // text rewritten in place. Watching `characterData` meant the Data & privacy poll and every
    // "Saving…"/"Saved" transition re-scanned the pane for headings that had not changed.
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container]);

  return entries;
}

/**
 * Which outline entry the reader is currently looking at.
 *
 * @remarks
 * Resolved by nearest-heading-above rather than by intersection ratio: a tall group can fill the
 * viewport with no heading visible at all, and a ratio-based spy goes blank exactly there. The
 * last heading to have crossed the top edge is always the group you are inside.
 *
 * @param container - The section's scroll container.
 * @param entries - The outline to track.
 * @returns the id of the entry in view, or null when there is nothing to track.
 */
export function useActiveOutlineEntry(
  container: HTMLElement | null,
  entries: readonly SettingsOutlineEntry[],
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const first = entries[0];
    if (container === null || first === undefined) {
      setActiveId(null);
      return;
    }

    // Resolved once per outline change rather than per scroll event. The headings do not move, so
    // re-finding them by id on every frame of a scroll was pure repetition — and the outline had
    // already held these very elements when it read their text.
    const headings = entries.map((entry) => ({ key: entry.key, element: entry.element }));

    let frame = 0;
    const read = (): void => {
      frame = 0;
      const top = container.getBoundingClientRect().top;
      let current = first.key;
      for (const heading of headings) {
        // 8px of slack so a heading resting exactly on the edge counts as reached. The list is in
        // document order, so the first heading still below the edge ends the search.
        if (heading.element.getBoundingClientRect().top - top > 8) break;
        current = heading.key;
      }
      setActiveId(current);
    };

    // One read per frame, not one per scroll event — a trackpad fires several between paints and
    // every extra one is a layout read whose answer cannot yet have changed on screen.
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };

    read();
    container.addEventListener('scroll', schedule, { passive: true });
    return () => {
      container.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container, entries]);

  return activeId;
}
