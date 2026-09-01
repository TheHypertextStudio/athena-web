import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import {
  nearestScrollport,
  useActiveOutlineEntry,
  useOutlineEntries,
} from '../../src/hooks/use-outline';

/** The marker the harness stamps, standing in for whatever a real surface uses. */
const ATTR = 'data-test-section';

/** A heading as the harness renders it: a title, and optionally a differing marker value. */
interface Heading {
  readonly text: string;
  readonly marker?: string;
}

interface HarnessProps {
  readonly headings: readonly Heading[];
  /** Whether the container is the thing that scrolls, or the viewport is. */
  readonly containerScrolls?: boolean;
}

/**
 * A surface with markable headings and the outline read off it.
 *
 * @remarks
 * Renders the outline as a list so assertions read the same information a reader would see: which
 * entries exist, in what order, and which one is marked current.
 *
 * @param props - The headings to render.
 * @returns the harness.
 */
function Harness({ headings, containerScrolls = true }: HarnessProps): React.JSX.Element {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const entries = useOutlineEntries(container, ATTR);
  const active = useActiveOutlineEntry(entries, containerScrolls ? container : null);

  return (
    <>
      <div ref={setContainer} data-testid="container">
        {headings.map((heading, index) => (
          <h2 key={index} {...{ [ATTR]: heading.marker ?? '' }}>
            {heading.text}
          </h2>
        ))}
      </div>
      <ul data-testid="outline">
        {entries.map((entry) => (
          <li key={entry.key} data-key={entry.key} data-current={entry.key === active}>
            {entry.label}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The outline rows currently rendered. */
function rows(): readonly HTMLElement[] {
  return Array.from(screen.getByTestId('outline').children) as HTMLElement[];
}

/** Pin an element's position, since jsdom performs no layout. */
function placeAt(element: Element, top: number): void {
  element.getBoundingClientRect = () => ({ top, bottom: top + 20 }) as DOMRect;
}

/** Place the container's top edge and each heading, then let the spy re-read. */
function layout(headingTops: readonly number[], containerTop = 0): void {
  const container = screen.getByTestId('container');
  placeAt(container, containerTop);
  const headings = container.querySelectorAll(`[${ATTR}]`);
  headingTops.forEach((top, index) => {
    const heading = headings[index];
    if (heading) placeAt(heading, top);
  });
  fireEvent.scroll(container);
}

describe('useOutlineEntries', () => {
  it('lists the marked headings in document order', async () => {
    render(<Harness headings={[{ text: 'Overview' }, { text: 'Billing' }, { text: 'Audit' }]} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rows().map((row) => row.textContent)).toEqual(['Overview', 'Billing', 'Audit']);
  });

  it('takes the title from the marker when it carries one', async () => {
    render(
      <Harness
        headings={[
          { text: 'Overview and everything under it', marker: 'Overview' },
          { text: 'Billing', marker: 'Billing' },
        ]}
      />,
    );

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    // A surface that already knows its section's name says so on the marker rather than making the
    // outline scrape whatever the heading happens to render.
    expect(rows()[0]?.textContent).toBe('Overview');
  });

  it('gives same-titled headings distinct identities', async () => {
    render(<Harness headings={[{ text: 'Billing' }, { text: 'Billing' }]} />);

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    // Keying by a slug of the title collapses these into one row and sends both to the same place.
    const keys = rows().map((row) => row.dataset['key']);
    expect(new Set(keys).size).toBe(2);
  });

  it('renders nothing for a screen with a single heading', async () => {
    render(<Harness headings={[{ text: 'Overview' }]} />);

    await waitFor(() => {
      expect(screen.getByTestId('outline')).toBeTruthy();
    });
    // An outline of one row only ever points at what the reader is already looking at.
    expect(rows()).toHaveLength(0);
  });

  it('picks up a heading that appears once its data loads', async () => {
    function Late(): React.JSX.Element {
      const [loaded, setLoaded] = React.useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setLoaded(true);
            }}
          >
            load
          </button>
          <Harness
            headings={
              loaded
                ? [{ text: 'Overview' }, { text: 'Billing' }, { text: 'Discounts' }]
                : [{ text: 'Overview' }, { text: 'Billing' }]
            }
          />
        </>
      );
    }
    render(<Late />);
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'load' }));

    // The outline is the headings, so a conditional section joins it the moment it renders.
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
  });
});

describe('useActiveOutlineEntry', () => {
  it('marks the last heading the reader has scrolled past', async () => {
    render(<Harness headings={[{ text: 'Overview' }, { text: 'Billing' }, { text: 'Audit' }]} />);
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    layout([-50, 400, 800]);

    await waitFor(() => {
      expect(rows().map((row) => row.dataset['current'])).toEqual(['true', 'false', 'false']);
    });
  });

  it('still names a section when the section is taller than the viewport', async () => {
    render(<Harness headings={[{ text: 'Overview' }, { text: 'Billing' }]} />);
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    // Deep inside the first section: its heading has scrolled far above, and the next one is far
    // below. Nothing is on screen to intersect, which is exactly where a ratio-based spy goes
    // blank and stops telling the reader where they are.
    layout([-4000, 3000]);

    await waitFor(() => {
      expect(rows()[0]?.dataset['current']).toBe('true');
    });
  });

  it('measures against the viewport when the page is what scrolls', async () => {
    render(
      <Harness headings={[{ text: 'Overview' }, { text: 'Billing' }]} containerScrolls={false} />,
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    // The container moves with the page here. Measuring the headings against it would compare two
    // things that travel together, and the answer would never change.
    const container = screen.getByTestId('container');
    placeAt(container, -600);
    const headings = container.querySelectorAll(`[${ATTR}]`);
    if (headings[0]) placeAt(headings[0], -600);
    if (headings[1]) placeAt(headings[1], -100);
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(rows().map((row) => row.dataset['current'])).toEqual(['false', 'true']);
    });
  });
});

describe('nearestScrollport', () => {
  it('finds the ancestor that actually scrolls', () => {
    const outer = document.createElement('div');
    outer.style.overflowY = 'auto';
    const inner = document.createElement('div');
    const leaf = document.createElement('p');
    outer.append(inner);
    inner.append(leaf);
    document.body.append(outer);

    expect(nearestScrollport(leaf)).toBe(outer);

    outer.remove();
  });

  it('reports the viewport when nothing between here and the root scrolls', () => {
    const leaf = document.createElement('p');
    document.body.append(leaf);

    expect(nearestScrollport(leaf)).toBeNull();

    leaf.remove();
  });

  it('reports the viewport before the element mounts', () => {
    expect(nearestScrollport(null)).toBeNull();
  });
});
