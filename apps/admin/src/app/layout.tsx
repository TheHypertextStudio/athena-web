import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

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
 * IBM Plex Mono — the monospace companion behind Tailwind's `font-mono` utility (identifier
 * chips, audit codes, resource IDs). Published as the `--font-ibm-plex-mono` CSS variable
 * the theme resolves `font-mono` to.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

/**
 * Root layout for the Docket service-admin console.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and mounts the global client {@link Providers} (theme, impersonation)
 * around every route. The per-section layouts decide whether to render the operator shell:
 * the `(admin)` route group wraps its pages in `AdminShell`, while `/sign-in` stays bare.
 * `suppressHydrationWarning` on `<html>` is required by `next-themes`, which sets the theme
 * class on the client before hydration.
 *
 * The tree is wrapped in MUI's {@link AppRouterCacheProvider}, which collects Emotion's
 * runtime styles during SSR and flushes them into `<head>` instead of emitting a
 * `<style data-emotion>` insertion next to every `@mui/icons-material` `<svg>`. Without it,
 * the App Router does not coordinate Emotion's SSR injection, so the server HTML and the
 * client render disagree and React reports a hydration mismatch. `enableCssLayer` wraps
 * MUI's styles in `@layer mui` so Tailwind's utilities keep winning the cascade.
 */
export const metadata = {
  title: 'Docket Admin',
  description: 'Docket service-admin console.',
};

/** The App Router root layout wrapping every page in the service-admin app. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <AppRouterCacheProvider options={{ key: 'mui', enableCssLayer: true }}>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
