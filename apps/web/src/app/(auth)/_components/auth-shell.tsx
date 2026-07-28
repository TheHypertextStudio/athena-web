/**
 * `(auth)/_components/auth-shell` — the shared chrome for the passkey auth screens.
 *
 * @remarks
 * Sign-in, sign-up, and account recovery all render through here so the three screens stay
 * visually identical and the polish is defined once. The chrome is {@link AuthLayout}: a centred
 * card whose left column holds the title and its supporting line, and whose right column holds
 * the form and the cross-link.
 *
 * The props are unchanged from the previous centred-card version, so the three screens compose
 * this exactly as before.
 */
import { AuthLayout } from '@docket/ui/components';
import type { JSX, ReactNode } from 'react';

import Wordmark from '@/components/wordmark';

import { PasskeyMark } from './passkey-mark';

/** Props for {@link AuthShell}. */
export interface AuthShellProps {
  /** The screen title (e.g. `'Create your account'`). */
  title: string;
  /** The supporting line under the title. */
  description: string;
  /** The screen body (form + actions). */
  children: ReactNode;
  /** The footer row (the cross-link to the other auth screen). */
  footer: ReactNode;
}

/**
 * The auth screen chrome: wordmark, then the title column beside the form column.
 *
 * @param props - See {@link AuthShellProps}.
 * @returns The composed auth screen.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps): JSX.Element {
  return (
    <AuthLayout
      brand={<Wordmark className="text-2xl" />}
      intro={
        <>
          <span
            className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <PasskeyMark className="size-4" />
          </span>
          <h1 className="text-headline-small text-on-surface font-medium">{title}</h1>
          <p className="text-on-surface-variant text-body-medium">{description}</p>
        </>
      }
    >
      {children}
      <div className="text-on-surface-variant text-body-medium">{footer}</div>
    </AuthLayout>
  );
}
