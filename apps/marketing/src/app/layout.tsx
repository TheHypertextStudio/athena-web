import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

import './globals.css';

/**
 * Root layout for the Docket marketing/landing site.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and frames every route with the shared {@link SiteHeader} and
 * {@link SiteFooter}. The marketing site is fully static (Server Components only): there is
 * no session, no theme toggle, and no client providers, so it renders without a running
 * backend on the neutral light token set.
 */
export const metadata: Metadata = {
  title: {
    default: 'Docket — the command center for everything you run',
    template: '%s — Docket',
  },
  description:
    'Docket is the calm command center for every organization you run — startups, nonprofits, and personal projects — unified in one daily view.',
};

/** The App Router root layout wrapping every page in the marketing site. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-screen antialiased">
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
