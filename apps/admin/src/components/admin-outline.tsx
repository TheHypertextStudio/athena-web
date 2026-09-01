'use client';

import { Text } from '@docket/ui/primitives';
import { type JSX, useEffect, useState } from 'react';

/** One entry in the outline, read off a rendered {@link AdminSection}. */
interface OutlineEntry {
  /** The section element's `id`, used as the jump target. */
  readonly id: string;
  /** The section's heading. */
  readonly title: string;
}

/** The attribute an {@link AdminSection} stamps so the outline can find it. */
export const SECTION_ATTRIBUTE = 'data-admin-section';

/** The id of the column the outline reads its sections from. */
export const CONTENT_ID = 'admin-content';

/** Turn a section title into a stable, URL-addressable id. */
export function sectionId(title: string): string {
  return `section-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * Track which sections a screen currently renders, and which one the reader is in.
 *
 * @remarks
 * The list is read from the DOM rather than declared alongside the page, because a screen's
 * sections are conditional — an organization with no Stripe customer renders fewer groups than one
 * mid-reconciliation, and a second hand-maintained list of them would drift the first time a
 * condition changed. A `MutationObserver` keeps the outline honest when a query resolves and a
 * group appears.
 *
 * @returns the sections in document order, and the id of the one currently in view.
 */
function useOutline(): readonly [readonly OutlineEntry[], string | undefined] {
  const [entries, setEntries] = useState<readonly OutlineEntry[]>([]);
  const [active, setActive] = useState<string | undefined>(undefined);

  useEffect(() => {
    const content = document.getElementById(CONTENT_ID);
    if (!content) return;

    const read = (): void => {
      setEntries(
        Array.from(content.querySelectorAll(`[${SECTION_ATTRIBUTE}]`), (node) => ({
          id: node.id,
          title: node.getAttribute(SECTION_ATTRIBUTE) ?? '',
        })),
      );
    };

    read();
    const mutations = new MutationObserver(read);
    mutations.observe(content, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
    };
  }, []);

  useEffect(() => {
    if (entries.length === 0) return;

    // The topmost section still intersecting the viewport is the one being read. Tracking the set
    // rather than the last event keeps the active item correct when several are on screen at once.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) visible.add(record.target.id);
          else visible.delete(record.target.id);
        }
        setActive(entries.find((entry) => visible.has(entry.id))?.id);
      },
      { rootMargin: '-8% 0px -70% 0px' },
    );

    for (const entry of entries) {
      const node = document.getElementById(entry.id);
      if (node) observer.observe(node);
    }
    return () => {
      observer.disconnect();
    };
  }, [entries]);

  return [entries, active];
}

/**
 * A screen's sections, as a rail you can jump from.
 *
 * @remarks
 * Operator screens run long — an organization carries an overview, a subscription, a Stripe
 * customer, its discounts, and every action that changes them — and reaching the one you came for
 * meant scrolling past all the others. The rail names what a screen holds before you scroll, and
 * marks where you are once you have.
 *
 * It renders nothing until it finds at least two sections, so a short screen does not grow a
 * navigation aid for a single group.
 *
 * @returns the outline rail, or nothing on a screen too short to need one.
 */
export function AdminOutline(): JSX.Element | null {
  const [entries, active] = useOutline();
  if (entries.length < 2) return null;

  return (
    <nav aria-label="On this page" className="sticky top-4 hidden self-start @4xl:block">
      <Text as="p" token="label-small" tone="muted" className="px-3 pb-2">
        On this page
      </Text>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={entry.id === active ? 'true' : undefined}
              className={`hover:bg-surface-container block rounded-md px-3 py-1.5 transition-colors ${
                entry.id === active ? 'text-on-surface' : 'text-on-surface-variant'
              }`}
            >
              <Text as="span" token={entry.id === active ? 'label-medium' : 'body-small'} truncate>
                {entry.title}
              </Text>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
