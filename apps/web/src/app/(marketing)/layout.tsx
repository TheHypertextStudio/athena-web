import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { META_DESCRIPTION } from '@/lib/marketing-copy';

import './marketing.css';

/**
 * Fraunces — the marketing display face. A variable old-style soft serif with an
 * optical-size axis: letterpress character at hero sizes, calm at section titles.
 * Loaded HERE (not the root layout) so the woff2 only ships with marketing routes;
 * published as `--font-fraunces`, which the `font-display` utility resolves
 * (see `@theme inline` in app/globals.css). Body copy stays IBM Plex Sans — the
 * typographic half of the honest seam into the product.
 */
const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'WONK'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

/** Metadata for marketing pages. */
export const metadata: Metadata = {
  title: {
    default: 'Docket — run every organization from one calm place',
    template: '%s — Docket',
  },
  description: META_DESCRIPTION,
};

/**
 * Marketing site layout — applies the paper-and-ink skin.
 *
 * @remarks
 * The `marketing` class re-assigns the semantic design tokens for this subtree (see
 * `marketing.css`), making these pages render light regardless of the browser color scheme.
 * The fixed full-viewport backdrop keeps macOS rubber-band overscroll
 * cream instead of flashing the app's dark canvas.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`marketing ${display.variable} bg-background text-foreground min-h-dvh antialiased`}
    >
      <div aria-hidden className="bg-paper fixed inset-0 -z-10" />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
