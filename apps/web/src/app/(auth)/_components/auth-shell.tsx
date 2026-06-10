/**
 * `(auth)/_components/auth-shell` — the shared, centered card chrome for the auth screens.
 *
 * @remarks
 * Both sign-in and sign-up render inside this shell so the two screens stay visually
 * identical: a full-height, centered surface; a circular passkey hero mark; a title +
 * supporting line; the screen's form; and a footer cross-link. Keeping the chrome here means
 * the polish (spacing, the hero treatment, the focus-friendly max width) is defined once.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { PasskeyMark } from './passkey-mark';

/** Props for {@link AuthShell}. */
export interface AuthShellProps {
  /** The card title (e.g. `'Create your account'`). */
  title: string;
  /** The supporting line under the title. */
  description: string;
  /** The screen body (form + actions). */
  children: ReactNode;
  /** The footer row (the cross-link to the other auth screen). */
  footer: ReactNode;
}

/**
 * The centered auth card with the passkey hero mark, title/description, body, and footer.
 *
 * @remarks
 * The serif "Docket" wordmark above the card and the faintly warm light backdrop are the
 * receiving half of the marketing site's honest seam: the paper hands you the tool here.
 * Card, form, and controls below the wordmark are 100% product design language.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps): JSX.Element {
  return (
    <main className="dark:bg-surface flex min-h-screen flex-col items-center justify-center gap-8 bg-[oklch(0.985_0.008_85)] px-6 py-12">
      <Link
        href="/"
        className="text-foreground wonk text-3xl font-semibold tracking-tight"
        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}
      >
        Docket
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span
            className="bg-primary/10 text-primary mb-2 flex size-12 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <PasskeyMark className="size-6" />
          </span>
          <CardTitle className="text-h1">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {children}
          <div className="text-on-surface-variant text-body text-center">{footer}</div>
        </CardContent>
      </Card>
    </main>
  );
}
