import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { ProductScreenshot } from './product-screenshot';

/** Props for {@link FeatureBand}. */
export interface FeatureBandProps {
  /** The section title. */
  readonly title: string;
  /** The one supporting sentence under the title. */
  readonly description: string;
  /** What belongs in the plate. */
  readonly surface: string;
  /** Background tone. `ink` inverts the band and is used once, as the page's peak. */
  readonly tone: 'paper' | 'ink';
}

/**
 * A full-bleed section: title across the top, then a wide product plate under it.
 *
 * @remarks
 * The counterweight to {@link FeatureSplit}. Where a split gives the plate half the width, a band
 * gives it all of it, so the two shapes alternating produce a rhythm rather than a march.
 *
 * @param props - Title, description, plate label, and background tone.
 * @returns The section.
 */
export function FeatureBand({ title, description, surface, tone }: FeatureBandProps): JSX.Element {
  const ink = tone === 'ink';
  return (
    <section className={ink ? 'bg-ink' : 'border-outline-variant bg-paper-deep border-y'}>
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <Text
          as="h2"
          token="display-small"
          tone="inherit"
          className={`font-display text-balance ${ink ? 'text-paper' : 'text-ink'}`}
        >
          {title}
        </Text>
        <Text
          as="p"
          token="body-large"
          tone="inherit"
          className={`mt-4 max-w-2xl text-balance ${ink ? 'text-paper/70' : 'text-ink-muted'}`}
        >
          {description}
        </Text>
        <div className="mt-12">
          <ProductScreenshot src={surface} alt={title} aspect="aspect-[16/9]" tone={tone} />
        </div>
      </div>
    </section>
  );
}
