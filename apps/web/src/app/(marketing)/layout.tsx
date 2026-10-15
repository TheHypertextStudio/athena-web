import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { preloadDisplayFonts } from '@/lib/fonts';
import { META_DESCRIPTION } from '@/lib/marketing-copy';

import '../fraunces.css';
import './marketing.css';

/** Metadata for marketing pages. */
export const metadata: Metadata = {
  title: {
    default: 'Docket',
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
  preloadDisplayFonts();
  return (
    <div className="marketing docket-font-display bg-surface text-on-surface min-h-dvh antialiased">
      <div aria-hidden className="bg-paper fixed inset-0 -z-10" />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
