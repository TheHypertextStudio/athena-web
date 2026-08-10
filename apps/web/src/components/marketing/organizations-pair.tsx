import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { PlaceholderSurface } from './placeholder-surface';

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
        Running a nonprofit board, a client business, and your own errands usually means three
        separate logins and three separate task lists. In Docket, each organization&apos;s data
        stays separate, but everything you&apos;re responsible for shows up under one login.
      </Text>
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        <PlaceholderSurface
          label="Organization one — its own people and tools"
          aspect="aspect-[5/4]"
          tone="paper"
        />
        <PlaceholderSurface
          label="Organization two — separate data"
          aspect="aspect-[5/4]"
          tone="paper"
        />
      </div>
      <div className="mt-5">
        <PlaceholderSurface
          label="An initiative pulling work from both"
          aspect="aspect-[64/9]"
          tone="paper"
        />
      </div>
    </section>
  );
}
