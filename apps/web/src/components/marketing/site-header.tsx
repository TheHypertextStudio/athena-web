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

/** Site header for marketing pages. */
export function SiteHeader(): JSX.Element {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-sm">
            D
          </span>
          Docket
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
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
