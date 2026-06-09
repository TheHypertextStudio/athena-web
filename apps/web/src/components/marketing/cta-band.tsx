import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signUpUrl } from '@/lib/marketing-links';

export function CtaBand(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="border-border bg-primary text-primary-foreground flex flex-col items-center gap-6 rounded-2xl border px-6 py-16 text-center">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Bring all your work under one calm roof
        </h2>
        <p className="text-primary-foreground/80 max-w-xl text-balance">
          Set up your personal command center in minutes, then add every organization you run. No
          credit card to begin.
        </p>
        <Button asChild size="lg" variant="secondary">
          <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
        </Button>
      </div>
    </section>
  );
}
