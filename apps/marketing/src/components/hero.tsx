import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { signInUrl, signUpUrl } from '@/lib/links';

/** One example organization shown in the hero's command-center preview. */
interface PreviewOrg {
  /** Single-letter avatar glyph. */
  glyph: string;
  /** The organization's display name. */
  name: string;
  /** A short, domain-neutral line of the day's work in that organization. */
  line: string;
}

/** The illustrative organizations shown side by side in the hero preview. */
const PREVIEW_ORGS: readonly PreviewOrg[] = [
  { glyph: 'N', name: 'Northwind (startup)', line: 'Ship the launch page · 3 tasks today' },
  { glyph: 'R', name: 'Riverkeepers (nonprofit)', line: 'Draft the donor update · due today' },
  { glyph: 'M', name: 'Just me', line: 'Reschedule the team offsite' },
];

/**
 * The landing hero: headline, sub-copy, calls-to-action, and a domain-neutral preview of
 * the cross-organization "Today" command center.
 *
 * @remarks
 * A Server Component. The preview is purely presentational (no live data) and deliberately
 * spans a startup, a nonprofit, and a personal space to show that Docket is for every kind
 * of work — not a developer tool. The primary call-to-action routes to {@link signUpUrl};
 * the secondary to {@link signInUrl}.
 */
export function Hero(): JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-primary/10 pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-80 max-w-4xl rounded-full blur-3xl" />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 pb-8 pt-20 sm:pt-28">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <span className="border-border text-muted-foreground rounded-full border px-3 py-1 text-xs font-medium">
            Linear for everything
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Run every organization from one calm place
          </h1>
          <p className="text-muted-foreground max-w-2xl text-balance text-lg">
            Docket is the command center for the work you actually do — your startup, your
            nonprofit, your side projects. Keep each one in its own space, then plan the whole day
            in a single view.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href={signUpUrl}>Get started — it&rsquo;s free</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={signInUrl}>Sign in</a>
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
