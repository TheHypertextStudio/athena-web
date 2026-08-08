import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * @remarks
 * Authored as a Next.js metadata route rather than a static `public/manifest.json` so it is
 * typechecked against {@link MetadataRoute.Manifest} and linted like the rest of `src/`. Next
 * injects the `<link rel="manifest">` tag automatically — no change to the root layout is needed
 * for the manifest itself.
 *
 * Two choices here are load-bearing:
 *
 * - `start_url` is `/today`, **not** `/`. The root route belongs to the `(marketing)` group, so an
 *   installed app launching at `/` would open the marketing site rather than the product. Someone
 *   who is signed out still lands correctly: `/today` is inside the client-gated `(app)` group and
 *   routes on to sign-in. `scope` stays `/` so marketing, auth, and onboarding remain in-app rather
 *   than kicking out to a browser tab mid-flow.
 * - `theme_color` and `background_color` are the **light** value of `--surface-container`
 *   (`oklch(0.97 0.009 264)` in `@docket/ui/styles/globals.css`), the token the app shell actually
 *   paints — not `--background`, which the shell never uses. A manifest colour cannot be
 *   media-scoped, so the per-scheme pair lives in the `viewport` export in `layout.tsx`; this value
 *   is the single-colour fallback for surfaces that read the manifest instead (notably the splash
 *   screen). The dark mark reads correctly against it.
 *
 * @see {@link file://./layout.tsx} for the media-scoped `theme-color` pair.
 * @see {@link file://../../scripts/generate-pwa-icons.ts} which generates the referenced icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Docket',
    short_name: 'Docket',
    description: 'Docket — one tool for every kind of work.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f2f5fb',
    theme_color: '#f2f5fb',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // The three daily surfaces, matching the primary navigation.
    shortcuts: [
      { name: 'Today', short_name: 'Today', url: '/today' },
      { name: 'Inbox', short_name: 'Inbox', url: '/inbox' },
      { name: 'Portfolio', short_name: 'Portfolio', url: '/portfolio' },
    ],
  };
}
