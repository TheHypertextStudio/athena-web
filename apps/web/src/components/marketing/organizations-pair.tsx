import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { ProductScreenshot } from './product-screenshot';

/**
 * Work across organizations — the only section built from two plates side by side.
 *
 * @remarks
 * The shape carries the point: two separate spaces, and a third narrow plate beneath them for the
 * view that draws across both. Saying the same thing in one plate and a sentence would need the
 * sentence to do the work.
 */
export function OrganizationsPair(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <Text
        as="h2"
        token="display-small"
        tone="inherit"
        className="font-display text-ink max-w-2xl text-balance"
      >
        Work across organizations
      </Text>
      <Text
        as="p"
        token="body-large"
        tone="inherit"
        className="text-ink-muted mt-4 max-w-2xl text-balance"
      >
        Each organization keeps its own data. One view draws your work out of all of them.
      </Text>
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        <ProductScreenshot
          src="/marketing/civic-studio.jpg"
          alt="Civic Studio projects"
          aspect="aspect-[5/4]"
          tone="paper"
        />
        <ProductScreenshot
          src="/marketing/neighborhood-fund.jpg"
          alt="Neighborhood Fund projects"
          aspect="aspect-[5/4]"
          tone="paper"
        />
      </div>
      <div className="mt-5">
        <ProductScreenshot
          src="/marketing/portfolio.jpg"
          alt="Portfolio across both organizations"
          aspect="aspect-[16/5]"
          tone="paper"
          position="center"
        />
      </div>
    </section>
  );
}
