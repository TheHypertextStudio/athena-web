import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signInUrl, signUpUrl } from '@/lib/marketing-links';

/**
 * Editorial hero — left-aligned Fraunces display headline over a hairline rule,
 * a Plex Mono eyebrow, and a single filled-ink CTA. No badges, no gradient blobs,
 * no centered SaaS symmetry.
 */
export function Hero(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6">
      <div className="border-border flex flex-col gap-8 border-b pt-20 pb-14 sm:pt-28 sm:pb-16">
        <p className="text-ink-muted text-sm font-medium">For people who run more than one thing</p>
        <h1 className="font-display text-display text-ink wonk max-w-4xl tracking-tight text-balance">
          Run every organization from one calm place.
        </h1>
        <p className="text-ink-muted max-w-2xl text-lg text-balance">
          Docket is the command center for the work you actually do — your startup, your nonprofit,
          your side projects. Each one keeps its own space; your day comes together in a single
          view.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <Button asChild size="lg">
            <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
          </Button>
          <Link
            href={signInUrl}
            className="text-ink hover:text-sienna decoration-border text-body font-medium underline underline-offset-4 transition-colors"
          >
            Sign in
          </Link>
          <span className="text-ink-muted font-mono text-xs">No credit card to start.</span>
        </div>
      </div>
    </section>
  );
}
