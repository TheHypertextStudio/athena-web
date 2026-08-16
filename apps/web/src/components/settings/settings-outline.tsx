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
  /** The heading's element id, used as the scroll target. */
  readonly id: string;
  /** The group's title, exactly as the section renders it. */
  readonly label: string;
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
        (element) => {
          const label = element.textContent.trim();
          return element.id && label ? [{ id: element.id, label }] : [];
        },
      );
      // A one-group section has nothing to navigate between; an outline of one row is a control
      // that only ever points at what you are already looking at.
      const next = found.length > 1 ? found : [];
      setEntries((current) =>
        current.length === next.length &&
        current.every((entry, i) => {
          const candidate = next[i];
          return entry.id === candidate?.id && entry.label === candidate.label;
        })
          ? current
          : next,
      );
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
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
    if (container === null || entries.length === 0) {
      setActiveId(null);
      return;
    }

    const read = (): void => {
      const top = container.getBoundingClientRect().top;
      let current: string | null = entries[0] === undefined ? null : entries[0].id;
      for (const entry of entries) {
        const element = container.querySelector(`#${CSS.escape(entry.id)}`);
        if (!(element instanceof HTMLElement)) continue;
        // 8px of slack so a heading resting exactly on the edge counts as reached.
        if (element.getBoundingClientRect().top - top <= 8) current = entry.id;
      }
      setActiveId(current);
    };

    read();
    container.addEventListener('scroll', read, { passive: true });
    return () => {
      container.removeEventListener('scroll', read);
    };
  }, [container, entries]);

  return activeId;
}
