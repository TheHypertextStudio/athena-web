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
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps): JSX.Element {
  return (
    <main className="bg-surface flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span
            className="bg-primary/10 text-primary mb-2 flex size-12 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <PasskeyMark className="size-6" />
          </span>
          <CardTitle className="text-2xl">{title}</CardTitle>
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
