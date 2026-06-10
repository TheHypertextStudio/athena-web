import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signInUrl, signUpUrl } from '@/lib/marketing-links';

interface NavLink {
  href: string;
  label: string;
}

const NAV: readonly NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

/**
 * Site header for marketing pages — typographic wordmark over a hairline rule.
 * The wordmark is set in Fraunces (the display face); nav and actions stay in
 * Plex Sans, quietly previewing the product's own typography.
 */
export function SiteHeader(): JSX.Element {
  return (
    <header className="border-border bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="font-display text-ink text-2xl leading-none font-semibold tracking-tight"
        >
          Docket
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground text-body transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={signInUrl}>Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={signUpUrl}>Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
