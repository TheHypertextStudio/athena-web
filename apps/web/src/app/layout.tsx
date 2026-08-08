import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import type { Metadata, Viewport } from 'next';
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
 * chips, task/cycle IDs). Published as the `--font-ibm-plex-mono` CSS variable the theme
 * resolves `font-mono` to.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

/**
 * Root layout for the Docket product app.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and mounts the global client {@link Providers} (active context, vocabulary)
 * around every route. Browser color-scheme handling is pure CSS in `@docket/ui` tokens.
 *
 * The tree is wrapped in MUI's {@link AppRouterCacheProvider}, which collects Emotion's
 * runtime styles during SSR and flushes them into `<head>` instead of emitting a
 * `<style data-emotion>` insertion next to every `@mui/icons-material` `<svg>`. Without it,
 * the App Router does not coordinate Emotion's SSR injection, so the server HTML and the
 * client render disagree and React reports a hydration mismatch. `enableCssLayer` wraps
 * MUI's styles in `@layer mui` so Tailwind's utilities keep winning the cascade.
 */
export const metadata: Metadata = {
  title: 'Docket',
  description: 'Docket — one tool for every kind of work.',
  applicationName: 'Docket',
  // iOS has no manifest support for the home screen: these tags are what Safari actually reads
  // when someone adds Docket to their home screen. `apple-icon.png` (a Next file convention in
  // this directory) supplies the icon. `statusBarStyle: 'default'` keeps the status bar opaque —
  // 'black-translucent' would slide content underneath it, which the shell is not laid out for.
  appleWebApp: { capable: true, title: 'Docket', statusBarStyle: 'default' },
  // Stop iOS Safari from turning task IDs and estimates into tappable "phone numbers".
  formatDetection: { telephone: false },
};

/**
 * Viewport and theme colour for every route.
 *
 * @remarks
 * `themeColor` is a media-scoped pair rather than a single value because Docket's canvas differs by
 * scheme: both entries are `--surface-container` from `@docket/ui/styles/globals.css`
 * (`oklch(0.97 0.009 264)` light, `oklch(0.23 0.012 264)` dark), the token the shell paints. A
 * single colour would leave installed window chrome mismatched against the app in one of the two
 * schemes. Theme selection is pure `prefers-color-scheme` CSS, so these track it exactly.
 *
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` resolve to non-zero values. It is
 * required for the shell's safe-area padding to do anything once Docket is installed and running
 * without browser chrome — on a notched device, the mobile top bar would otherwise sit under the
 * notch and content under the home indicator.
 *
 * `maximumScale`/`userScalable` are deliberately left at their defaults: clamping zoom is an
 * accessibility failure, and the craft rubric's a11y gate would rightly reject it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f5fb' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1d23' },
  ],
};

/** The App Router root layout wrapping every page in the product app. */
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
