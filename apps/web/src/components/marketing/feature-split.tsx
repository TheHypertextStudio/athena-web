import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { ProductScreenshot } from './product-screenshot';

/** Props for {@link FeatureSplit}. */
export interface FeatureSplitProps {
  /** The section title. Short enough to read while scrolling past it. */
  readonly title: string;
  /** The one supporting sentence under the title. */
  readonly description: string;
  /** Which side the product plate sits on. Alternated by the caller so the page does not march. */
  readonly side: 'left' | 'right';
  /** Public path to the product screenshot. */
  readonly surface: string;
}

/**
 * A section where the title holds one column and the product plate holds the other.
 *
 * @remarks
 * The columns are uneven (2fr text, 3fr plate) rather than a 50/50 split, and the caller
 * alternates {@link FeatureSplitProps.side}. Even columns in a repeating order is the layout that
 * makes a page read as generated.
 *
 * @param props - Title, description, plate side, and plate label.
 * @returns The section.
 */
export function FeatureSplit({
  title,
  description,
  side,
  surface,
}: FeatureSplitProps): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <div className="grid items-center gap-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-16">
        <div className={side === 'left' ? 'md:order-2' : ''}>
          <Text
            as="h2"
            token="display-small"
            tone="inherit"
            className="font-display text-ink text-balance"
          >
            {title}
          </Text>
          <Text
            as="p"
            token="body-large"
            tone="inherit"
            className="text-ink-muted mt-4 text-balance"
          >
            {description}
          </Text>
        </div>
        <div className={side === 'left' ? 'md:order-1' : ''}>
          <ProductScreenshot src={surface} alt={title} aspect="aspect-[4/3]" tone="paper" />
        </div>
      </div>
    </section>
  );
}
