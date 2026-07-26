'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { appHomeUrl, signInUrl, signUpUrl } from '@/lib/marketing-links';

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
 * While the state is `'unknown'` these render the visitor treatment, which is correct for almost
 * everyone reading a public landing page and keeps the statically-served first paint stable. The
 * signed-in swap is therefore additive rather than a visible correction.
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
        <Button asChild size="sm">
          <Link href={appHomeUrl}>Open Docket</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href={signInUrl}>Sign in</Link>
      </Button>
      <Button asChild size="sm">
        <Link href={signUpUrl}>Get started</Link>
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
          <Link href={appHomeUrl}>Open Docket</Link>
        </Button>
        <span className="text-ink-muted font-mono text-xs">You&rsquo;re already signed in.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Button asChild size="lg">
        <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
      </Button>
      <Link
        href={signInUrl}
        className="text-ink hover:text-sienna decoration-border text-body-medium font-medium underline underline-offset-4 transition-colors"
      >
        Sign in
      </Link>
      <span className="text-ink-muted font-mono text-xs">No credit card to start.</span>
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
  const signedIn = auth === 'signed-in';
  return (
    <Link href={signedIn ? appHomeUrl : signUpUrl} className={className}>
      {signedIn ? 'Open Docket' : 'Get started'}
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
          <Link href={appHomeUrl}>Open Docket</Link>
        </Button>
        <span className="text-paper/60 font-mono text-xs">Pick up where you left off.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Button asChild size="lg" variant="secondary">
        <Link href={signUpUrl}>Get started — it&rsquo;s free</Link>
      </Button>
      <span className="text-paper/60 font-mono text-xs">No credit card to begin.</span>
    </div>
  );
}
