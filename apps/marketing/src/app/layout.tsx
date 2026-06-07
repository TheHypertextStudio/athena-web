import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

import './globals.css';

/**
 * IBM Plex Sans — Docket's sole brand typeface. Loaded once at the app root and
 * self-hosted by `next/font` (no runtime request to Google). Published as the
 * `--font-ibm-plex-sans` CSS variable that `@docket/ui`'s Tailwind theme resolves
 * `font-sans` (the default body family) to, so every surface inherits it without
 * per-component wiring. `display: 'swap'` paints text immediately with the metric-matched
 * fallback to avoid invisible text on first load.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

/**
 * IBM Plex Mono — the monospace companion behind Tailwind's `font-mono` utility. Published
 * as the `--font-ibm-plex-mono` CSS variable the theme resolves `font-mono` to.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

/**
 * Root layout for the Docket marketing/landing site.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and frames every route with the shared {@link SiteHeader} and
 * {@link SiteFooter}. The marketing site is fully static (Server Components only): there is
 * no session, no theme toggle, and no client providers, so it renders without a running
 * backend on the neutral light token set.
 *
 * The tree is wrapped in MUI's {@link AppRouterCacheProvider}, which collects Emotion's
 * runtime styles during SSR and flushes them into `<head>` instead of emitting a
 * `<style data-emotion>` insertion next to every `@mui/icons-material` `<svg>` (e.g. the
 * FeatureGrid glyphs). Without it, the App Router does not coordinate Emotion's SSR
 * injection, so the server HTML and the client render disagree and React reports a
 * hydration mismatch. `enableCssLayer` wraps MUI's styles in `@layer mui` so Tailwind's
 * utilities keep winning the cascade.
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <AppRouterCacheProvider options={{ key: 'mui', enableCssLayer: true }}>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
