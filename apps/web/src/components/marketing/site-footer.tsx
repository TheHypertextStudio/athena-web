import Link from 'next/link';
import type { JSX } from 'react';

import { TAGLINE } from '@/lib/marketing-copy';
import { signUpUrl } from '@/lib/marketing-links';

interface FooterColumn {
  title: string;
  links: readonly { href: string; label: string }[];
}

const COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: signUpUrl, label: 'Get started' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

/**
 * Site footer for marketing pages — colophon register: serif wordmark, the canonical
 * tagline, mono-capped link columns, and a typesetting signature line. Sits on the
 * deeper paper tone under a hairline rule.
 */
export function SiteFooter(): JSX.Element {
  return (
    <footer className="border-border bg-paper-deep border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <span className="font-display text-ink wonk text-2xl leading-none font-semibold tracking-tight">
            Docket
          </span>
          <p className="text-muted-foreground text-body max-w-sm">{TAGLINE}</p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">
              {column.title}
            </p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground text-body transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-border border-t">
        <div className="text-ink-muted mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-6 font-mono text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© Docket. All rights reserved.</p>
          <p>Set in Fraunces &amp; IBM Plex.</p>
        </div>
      </div>
    </footer>
  );
}
