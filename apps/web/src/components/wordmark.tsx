/**
 * `Wordmark` — the "Docket" wordmark in the marketing display face, linked home.
 *
 * @remarks
 * Four surfaces used to inline this with a `style={{ fontFamily: 'var(--font-fraunces), …' }}`
 * attribute, which bypassed the `font-display` theme token and silently diverged (the consent
 * screen's copy sat outside the route group that publishes `--font-fraunces`, so it rendered in
 * Georgia). One component, one token.
 *
 * `font-display` only resolves where a layout has published `--font-fraunces` via `next/font` —
 * the `(auth)` and `(marketing)` route groups do. The token's own fallback stack covers anywhere
 * else, so this degrades to a serif rather than to the body face.
 *
 * @see {@link file://../app/(auth)/_components/auth-shell.tsx} for the auth-screen usage.
 */
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import type { JSX } from 'react';

/** Props for {@link Wordmark}. */
export interface WordmarkProps {
  /** Where the wordmark links (default the marketing home page). */
  readonly href?: string;
  /** Extra classes, typically a size override. */
  readonly className?: string;
}

/**
 * The linked Docket wordmark.
 *
 * @param props - See {@link WordmarkProps}.
 * @returns A `next/link` rendering the wordmark.
 */
export default function Wordmark({ href = '/', className }: WordmarkProps): JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        'font-display wonk inline-flex w-fit text-3xl leading-none font-semibold tracking-tight',
        className,
      )}
    >
      Docket
    </Link>
  );
}
