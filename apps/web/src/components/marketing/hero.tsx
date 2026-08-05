import type { JSX } from 'react';

import { HeroActions } from './marketing-cta';

/**
 * Editorial hero — left-aligned Fraunces display headline over a hairline rule,
 * a Plex Mono eyebrow, and a single filled-ink CTA. No badges, no gradient blobs,
 * no centered SaaS symmetry.
 *
 * @remarks
 * The action row is delegated to {@link HeroActions} so it can reflect the session without making
 * the whole hero a Client Component.
 */
export function Hero(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6">
      <div className="border-outline-variant flex flex-col gap-8 border-b pt-20 pb-14 sm:pt-28 sm:pb-16">
        <p className="text-ink-muted text-sm font-medium">For people who run more than one thing</p>
        <h1 className="font-display text-display-large text-ink wonk max-w-4xl tracking-tight text-balance">
          Run every organization from one calm place.
        </h1>
        <p className="text-ink-muted max-w-2xl text-lg text-balance">
          Docket is the command center for the work you actually do — your startup, your nonprofit,
          your side projects. Each one keeps its own space; your day comes together in a single
          view.
        </p>
        <HeroActions />
      </div>
    </section>
  );
}
