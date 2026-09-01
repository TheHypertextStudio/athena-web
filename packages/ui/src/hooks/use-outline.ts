'use client';

/**
 * `@docket/ui/hooks` — a jump-list for a long screen, read off the screen itself.
 *
 * @remarks
 * ## Why the outline is derived rather than declared
 *
 * The obvious implementation is a list of section names kept beside the page. That is a second copy
 * of something the page already states, and a second copy is a copy that goes stale — a section
 * added, renamed, reordered, or conditionally hidden has to be remembered in two places, and the
 * one nobody remembers is the list. So the outline is read from the rendered DOM: each section
 * marks its heading with an attribute, and this collects those headings. A section that only
 * appears once its data loads joins the outline at the same moment, which is what the
 * `MutationObserver` is for.
 *
 * ## Why it is shared
 *
 * Two screens grew this independently — the product's settings pane and the operator console — and
 * the second copy reintroduced both bugs the first had already fixed: keying entries by a slug of
 * the title, which collides when two sections share a name, and resolving the active entry by
 * intersection, which highlights nothing at all inside a section taller than the observed band.
 * Both fixes live here now, once.
 */
import { useEffect, useState } from 'react';

/** One entry in an outline. */
export interface OutlineEntry {
  /**
   * A key unique within this outline.
   *
   * @remarks
   * Not a slug of the title. A title can be user-supplied — the Labels screen renders one group per
   * label group the reader created — so two entries can slug to the same value, or to an empty one
   * if a name is all emoji. Position makes the key unique where the title cannot.
   */
  readonly key: string;
  /** The title, exactly as the screen renders it. */
  readonly label: string;
  /**
   * The heading element itself.
   *
   * @remarks
   * Held rather than re-found by id on every scroll frame. It also sidesteps duplicate ids
   * entirely: `querySelector('#…')` returns the first match, so two sections sharing a slug would
   * scroll to the same place and the spy would highlight the wrong row.
   */
  readonly element: HTMLElement;
}

/** Whether two outlines describe the same headings in the same order. */
function sameEntries(current: readonly OutlineEntry[], next: readonly OutlineEntry[]): boolean {
  return (
    current.length === next.length &&
    current.every((entry, index) => {
      const candidate = next[index];
      return entry.key === candidate?.key && entry.element === candidate.element;
    })
  );
}

/**
 * The headings currently rendered inside a container.
 *
 * @remarks
 * Returns the same array across re-reads that found the same headings. Callers pass this into the
 * scroll spy's dependencies, and a fresh array each time would tear down and rebuild the spy on
 * every unrelated DOM change under the container — which, on a screen polling a query, is every
 * few seconds.
 *
 * @param container - The element to search, or null before it mounts.
 * @param attribute - The attribute a heading carries to opt into the outline.
 * @returns the outline in document order; empty for a screen with one heading or none, since an
 * outline of one row is a control that only points at what you are already looking at.
 */
export function useOutlineEntries(
  container: HTMLElement | null,
  attribute: string,
): readonly OutlineEntry[] {
  const [entries, setEntries] = useState<readonly OutlineEntry[]>([]);

  useEffect(() => {
    if (container === null) {
      setEntries([]);
      return;
    }

    const read = (): void => {
      const found = [...container.querySelectorAll(`[${attribute}]`)].flatMap((element, index) => {
        // The marker either carries the title or is valueless, in which case the heading's own
        // text is the title. An empty attribute is the second case, not a title of ''.
        const marker = (element.getAttribute(attribute) ?? '').trim();
        const label = marker === '' ? element.textContent.trim() : marker;
        if (!(element instanceof HTMLElement) || !label) return [];
        return [{ key: `${String(index)}:${label}`, label, element }];
      });
      const next = found.length > 1 ? found : [];
      setEntries((current) => (sameEntries(current, next) ? current : next));
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
    // `childList` alone: a heading appears or disappears by mounting, never by having its text
    // rewritten in place. Watching `characterData` meant every "Saving…"/"Saved" transition
    // re-scanned the whole screen for headings that had not changed.
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container, attribute]);

  return entries;
}

/**
 * The nearest ancestor that actually scrolls `element`.
 *
 * @remarks
 * For callers that do not already hold their scroll container. Docket's app shell scrolls its
 * `<main>` rather than the window, so a spy that measured against the viewport would be measuring
 * against something that never moves — but which element that is belongs to the shell, not to the
 * screen rendering an outline. Walking up from the content answers it without every screen having
 * to know.
 *
 * @param element - Where to start walking, or null before it mounts.
 * @returns the scrolling ancestor, or null when the page scrolls in the viewport.
 */
export function nearestScrollport(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Which outline entry the reader is currently looking at.
 *
 * @remarks
 * Resolved by nearest-heading-above rather than by intersection ratio: a tall section can fill the
 * viewport with no heading visible at all, and a ratio-based spy goes blank exactly there. The last
 * heading to have crossed the top edge is always the section you are inside.
 *
 * @param entries - The outline to track.
 * @param scrollport - The element that scrolls, or null when the page scrolls in the viewport.
 * @returns the key of the entry in view, or null when there is nothing to track.
 */
export function useActiveOutlineEntry(
  entries: readonly OutlineEntry[],
  scrollport: HTMLElement | null,
): string | null {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    const first = entries[0];
    if (first === undefined) {
      setActiveKey(null);
      return;
    }

    let frame = 0;
    const read = (): void => {
      frame = 0;
      // The top edge of whatever is scrolling: a scrolling container's own top, which stays put
      // while its content moves, or the viewport's, which is zero. Measuring against the container
      // when the *page* is what scrolls would compare two things that move together, and the answer
      // would never change.
      const top = scrollport === null ? 0 : scrollport.getBoundingClientRect().top;
      let current = first.key;
      for (const entry of entries) {
        // 8px of slack so a heading resting exactly on the edge counts as reached. The list is in
        // document order, so the first heading still below the edge ends the search.
        if (entry.element.getBoundingClientRect().top - top > 8) break;
        current = entry.key;
      }
      setActiveKey(current);
    };

    // One read per frame, not one per scroll event — a trackpad fires several between paints and
    // every extra one is a layout read whose answer cannot yet have changed on screen.
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };

    read();
    const target: HTMLElement | Window = scrollport ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    return () => {
      target.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [entries, scrollport]);

  return activeKey;
}
