import Link from 'next/link';
import type { JSX } from 'react';

import { FooterEntryLink } from './marketing-cta';

interface FooterColumn {
  title: string;
  links: readonly { href: string; label: string }[];
  /**
   * Whether this column ends with the auth-dependent entry link ({@link FooterEntryLink}).
   *
   * @remarks
   * An explicit flag rather than matching on `title`, so renaming the column heading cannot silently
   * drop the link.
   */
  entryLink?: boolean;
}

/** The shared link treatment, passed to {@link FooterEntryLink} so styling stays owned here. */
const LINK_CLASS =
  'text-on-surface-variant hover:text-on-surface text-body-medium transition-colors';

const COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Product',
    links: [{ href: '/pricing', label: 'Pricing' }],
    entryLink: true,
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
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
    <footer className="border-outline-variant bg-paper-deep border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <span className="font-display text-ink wonk text-2xl leading-none font-semibold tracking-tight">
            Docket
          </span>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <p className="text-ink-muted text-sm font-medium">{column.title}</p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className={LINK_CLASS}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.entryLink ? (
                <li>
                  <FooterEntryLink className={LINK_CLASS} />
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-outline-variant border-t">
        <div className="text-ink-muted mx-auto w-full max-w-6xl px-6 py-6 font-mono text-xs">
          <p>© Docket. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
