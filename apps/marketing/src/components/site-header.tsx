import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signInUrl, signUpUrl } from '@/lib/links';

/** A single primary navigation entry in the marketing header. */
interface NavLink {
  /** Where the entry points (an in-site route or on-page anchor). */
  href: string;
  /** The entry's display label. */
  label: string;
}

/** The marketing site's primary navigation, in display order. */
const NAV: readonly NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

/**
 * The sticky top navigation bar shared by every marketing page.
 *
 * @remarks
 * A Server Component (no interactivity): the wordmark links home, the in-site nav links
 * collapse out of view on small screens, and the two calls-to-action route to the product
 * app's sign-in / sign-up screens (absolute origins from {@link signInUrl} /
 * {@link signUpUrl}). The bar is translucent and blurs the content scrolling beneath it.
 */
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
            <a href={signInUrl}>Sign in</a>
          </Button>
          <Button asChild size="sm">
            <a href={signUpUrl}>Get started</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
