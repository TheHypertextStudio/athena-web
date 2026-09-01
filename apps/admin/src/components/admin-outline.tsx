'use client';

import { nearestScrollport, useActiveOutlineEntry, useOutlineEntries } from '@docket/ui/hooks';
import { Text } from '@docket/ui/primitives';
import { type JSX, useEffect, useMemo, useState } from 'react';

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
  const [content, setContent] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContent(document.getElementById(CONTENT_ID));
  }, []);

  const entries = useOutlineEntries(content, SECTION_ATTRIBUTE);
  const scrollport = useMemo(() => nearestScrollport(content), [content]);
  const active = useActiveOutlineEntry(entries, scrollport);

  if (entries.length === 0) return null;

  return (
    <nav aria-label="On this page" className="sticky top-4 hidden self-start @4xl:block">
      <Text as="p" token="label-small" tone="muted" className="px-3 pb-2">
        On this page
      </Text>
      <ul className="flex flex-col">
        {entries.map((entry) => {
          const current = entry.key === active;
          return (
            <li key={entry.key}>
              <a
                href={`#${entry.element.id}`}
                aria-current={current ? 'true' : undefined}
                className={`hover:bg-surface-container block rounded-md px-3 py-1.5 transition-colors ${
                  current ? 'text-on-surface' : 'text-on-surface-variant'
                }`}
              >
                <Text as="span" token={current ? 'label-medium' : 'body-small'} truncate>
                  {entry.label}
                </Text>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
