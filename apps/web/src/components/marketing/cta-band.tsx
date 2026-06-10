import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signUpUrl } from '@/lib/marketing-links';

/**
 * Closing call-to-action — a full-bleed ink panel: the page's one inversion, typographic
 * rather than a floating rounded card.
 */
export function CtaBand(): JSX.Element {
  return (
    <section className="bg-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-7 px-6 py-24">
        <h2 className="font-display text-title text-paper max-w-2xl tracking-tight text-balance">
          Bring all your work under one calm roof.
        </h2>
        <p className="text-paper/75 max-w-xl text-base text-balance">
          Set up your personal command center in minutes, then add every organization you run.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <Button asChild size="lg" variant="secondary">
            <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
          </Button>
          <span className="text-paper/60 font-mono text-xs">No credit card to begin.</span>
        </div>
      </div>
    </section>
  );
}
