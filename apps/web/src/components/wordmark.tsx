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
 * The size is `text-headline-small`, an MD3 type token, and it lives here rather than at each
 * call site. Every one of the four call sites used to pass `className="text-2xl"` to override a
 * `text-3xl` default — two stock Tailwind sizes, neither of which the MD3 scale in
 * `packages/ui/src/styles/globals.css` defines, so the brand lockup was the one text node on the
 * auth screens that resolved to no token at all. `text-headline-small` is 1.5rem, identical to the
 * `text-2xl` every caller was already asking for, so nothing moved; what changed is that the size
 * now comes from the scale and no caller can pick its own.
 *
 * `leading-none`, `font-semibold` and `tracking-tight` stay: a wordmark is a lockup, not running
 * text, and each of those resolves to a theme token rather than an arbitrary value. In Tailwind v4
 * they win over the type token's companion line-height/weight/tracking regardless of source order,
 * because `text-*` emits those three through `var(--tw-leading, …)`-style indirections that the
 * dedicated utilities set.
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
  /**
   * Extra classes.
   *
   * @remarks
   * Not a size hook: the size is an MD3 type token owned by this component. Passing a stock
   * Tailwind size here is what the `(auth)` type-scale contract in
   * `apps/web/tests/components/auth/auth-visual-contract.test.ts` fails on.
   */
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
        'font-display wonk text-headline-small inline-flex w-fit leading-none font-semibold tracking-tight',
        className,
      )}
    >
      Docket
    </Link>
  );
}
