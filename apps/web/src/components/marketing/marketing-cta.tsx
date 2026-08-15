'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { openAppUrl, signInUrl } from '@/lib/marketing-links';

import { useMarketingAuthState } from './use-marketing-auth';

/**
 * The auth-aware call-to-action clusters for the marketing site.
 *
 * @remarks
 * Small client islands inside otherwise static Server Components. The marketing pages are public,
 * cacheable, and SEO-relevant, so reading the session on the *server* — which would mean touching
 * `cookies()` and opting the whole landing page out of static rendering — is the wrong trade for a
 * pair of button labels. Isolating the reactive part keeps `/` static and the session read to one
 * request.
 *
 * Why this exists at all: every CTA on the site used to hardcode "Sign in" / "Get started", so a
 * person with a live session opening Docket was greeted by a page insisting they authenticate, and
 * the obvious click took them into `/sign-in` — which is where the passkey prompt lives. The
 * marketing surface was funnelling signed-in people into the auth flow.
 *
 * **Label and destination are now decided in different places, and that separation is the point.**
 * While the state is `'unknown'` these still render the visitor *copy*, which is correct for almost
 * everyone reading a public landing page and keeps the statically-served first paint stable — so the
 * signed-in swap stays additive rather than a visible correction.
 *
 * The same reasoning was flatly wrong for the *destination*, and it shipped a real defect: sampling
 * the header CTA every 25ms from navigation commit showed `href="/sign-up"` until the client session
 * read settled at ~345ms. Someone who clicked inside that window — the normal case, not the edge —
 * was sent into the auth funnel, watched `/sign-up` paint, and was then bounced to `/today`. A
 * cosmetic label may lag the truth; a link target may not. Every primary CTA therefore points at
 * {@link openAppUrl} unconditionally, and the server decides where that lands.
 *
 * `prefetch={false}` on those links because `/open` is a redirect, not a destination: it reads the
 * session and throws. Prefetching would run that session read on hover for a route whose entire
 * output is a `Location`, which is wasted work at best.
 *
 * The secondary "Sign in" link still points at `/sign-in`, which is now safe — that route
 * server-redirects an authenticated visitor with zero paint.
 *
 * The primary controls carry `data-testid="open-app"`. The visible label is "Open Docket", which is
 * the brand-correct wording and stays; the test id is what makes the entry control unambiguously
 * identifiable to the launch checks that name an "Open app" control.
 */

/**
 * Header actions — "Sign in" + "Get started", or a single "Open Docket" once a session is known.
 *
 * @returns The header's right-hand action cluster.
 */
export function HeaderActions(): JSX.Element {
  const auth = useMarketingAuthState();

  if (auth === 'signed-in') {
    return (
      <div className="flex items-center gap-2">
        <Button asChild className="h-10 min-h-10">
          <Link href={openAppUrl} prefetch={false} data-testid="open-app">
            Open Docket
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" className="h-10 min-h-10 max-[359px]:hidden">
        <Link href={signInUrl}>Sign in</Link>
      </Button>
      <Button asChild className="h-10 min-h-10">
        <Link href={openAppUrl} prefetch={false} data-testid="open-app">
          Create free account
        </Link>
      </Button>
    </div>
  );
}

/**
 * Hero actions — the primary conversion pair, or "Open Docket" for someone already signed in.
 *
 * @returns The hero's action row.
 */
export function HeroActions(): JSX.Element {
  const auth = useMarketingAuthState();

  if (auth === 'signed-in') {
    return (
      <div className="flex flex-wrap items-center gap-5">
        <Button asChild size="lg">
          <Link href={openAppUrl} prefetch={false} data-testid="open-app">
            Open Docket
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Button asChild size="lg">
        <Link href={openAppUrl} prefetch={false} data-testid="open-app">
          Create free account
        </Link>
      </Button>
      <Link
        href={signInUrl}
        className="text-ink hover:text-sienna decoration-outline-variant text-body-medium font-medium underline underline-offset-4 transition-colors"
      >
        Sign in
      </Link>
    </div>
  );
}

/** Props for {@link FooterEntryLink}. */
export interface FooterEntryLinkProps {
  /** The footer's own link styling, kept in the footer so this component owns no layout opinion. */
  readonly className: string;
}

/**
 * The footer's single auth-dependent link — "Get started", or "Open Docket" once signed in.
 *
 * @remarks
 * A sitemap link rather than a CTA button, but it is the last place on the page that would still
 * invite a signed-in person to create the account they already have.
 *
 * @param props - The footer's link class name.
 * @returns The Product column's entry link.
 */
export function FooterEntryLink({ className }: FooterEntryLinkProps): JSX.Element {
  const auth = useMarketingAuthState();
  return (
    <Link href={openAppUrl} prefetch={false} className={className} data-testid="open-app">
      {auth === 'signed-in' ? 'Open Docket' : 'Create free account'}
    </Link>
  );
}

/**
 * Closing-band action — inverted on the ink panel, so the signed-in variant keeps `secondary`.
 *
 * @returns The closing call-to-action row.
 */
export function CtaBandActions(): JSX.Element {
  const auth = useMarketingAuthState();

  if (auth === 'signed-in') {
    return (
      <div className="flex flex-wrap items-center gap-5">
        <Button asChild size="lg" variant="secondary">
          <Link href={openAppUrl} prefetch={false} data-testid="open-app">
            Open Docket
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Button asChild size="lg" variant="secondary">
        <Link href={openAppUrl} prefetch={false} data-testid="open-app">
          Create free account
        </Link>
      </Button>
    </div>
  );
}
