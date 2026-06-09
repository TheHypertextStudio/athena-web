import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signInUrl, signUpUrl } from '@/lib/marketing-links';

interface PreviewOrg {
  glyph: string;
  name: string;
  line: string;
}

const PREVIEW_ORGS: readonly PreviewOrg[] = [
  { glyph: 'N', name: 'Northwind (startup)', line: 'Ship the launch page · 3 tasks today' },
  { glyph: 'R', name: 'Riverkeepers (nonprofit)', line: 'Draft the donor update · due today' },
  { glyph: 'M', name: 'Just me', line: 'Reschedule the team offsite' },
];

/** Hero section with product tagline and call-to-action. */
export function Hero(): JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-primary/10 pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-80 max-w-4xl rounded-full blur-3xl" />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 pt-20 pb-8 sm:pt-28">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <span className="border-border text-muted-foreground rounded-full border px-3 py-1 text-xs font-medium">
            Linear for everything
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Run every organization from one calm place
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg text-balance">
            Docket is the command center for the work you actually do — your startup, your
            nonprofit, your side projects. Keep each one in its own space, then plan the whole day
            in a single view.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={signInUrl}>Sign in</Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            No credit card to start your personal command center.
          </p>
        </div>

        <div className="border-border bg-card w-full max-w-3xl rounded-xl border p-2 shadow-xl">
          <div className="border-border/60 bg-background rounded-lg border">
            <div className="border-border/60 flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-medium">Today</p>
              <span className="text-muted-foreground text-xs">across 3 organizations</span>
            </div>
            <ul className="divide-border/60 divide-y">
              {PREVIEW_ORGS.map((org) => (
                <li key={org.name} className="flex items-center gap-3 px-4 py-3">
                  <span className="bg-secondary text-secondary-foreground grid size-8 shrink-0 place-items-center rounded-md text-sm font-medium">
                    {org.glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{org.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">{org.line}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
