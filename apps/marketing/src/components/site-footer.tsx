import Link from 'next/link';
import type { JSX } from 'react';

import { signUpUrl } from '@/lib/links';

/** A labeled group of related footer links. */
interface FooterColumn {
  /** The column heading. */
  title: string;
  /** The links within the column, in display order. */
  links: readonly { href: string; label: string; external?: boolean }[];
}

/** The marketing footer's link columns, in display order. */
const COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: signUpUrl, label: 'Get started', external: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/#how-it-works', label: 'How it works' },
    ],
  },
];

/**
 * The site-wide footer shared by every marketing page.
 *
 * @remarks
 * A Server Component: a short brand blurb beside grouped navigation columns, then a thin
 * legal row. External links (into the product app) render as plain anchors; in-site links
 * use the Next `<Link>` component. The copyright year is intentionally static — a fixed
 * brand line, not a live clock — so the page stays a pure render with no date dependency.
 */
export function SiteFooter(): JSX.Element {
  return (
    <footer className="border-border/60 bg-card/30 border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-sm">
              D
            </span>
            Docket
          </span>
          <p className="text-muted-foreground max-w-sm text-sm">
            One calm command center for every organization you run — startups, nonprofits, and
            everything in between.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© Docket. All rights reserved.</p>
          <p>The calm command center for work.</p>
        </div>
      </div>
    </footer>
  );
}
