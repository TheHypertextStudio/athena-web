/**
 * `(auth)/_components/auth-feedback` — the shared pending spinner and error alert.
 *
 * @remarks
 * Small presentational pieces shared by both auth screens so pending and error states look
 * and behave identically. {@link AuthError} renders an assertive `role="alert"` region so
 * screen readers announce failures the moment they appear; {@link Spinner} is a decorative,
 * `aria-hidden` indicator paired with visible "…ing" button copy.
 */
import { RefreshCw } from '@docket/ui/icons';
import type { JSX } from 'react';

/** A spinning indicator for in-flight auth actions (decorative; copy conveys the state). */
export function Spinner(): JSX.Element {
  return <RefreshCw className="size-4 animate-spin" aria-hidden="true" />;
}

/** Props for {@link AuthError}. */
export interface AuthErrorProps {
  /** The message to announce, or `null`/empty to render nothing. */
  message: string | null;
}

/**
 * An assertive error region. Renders nothing when there is no message.
 *
 * @remarks
 * `role="alert"` (implicitly `aria-live="assertive"`) so the failure is announced
 * immediately; styled with the destructive token so it reads as an error visually too.
 */
export function AuthError({ message }: AuthErrorProps): JSX.Element | null {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive text-body rounded-md border px-3 py-2"
    >
      {message}
    </p>
  );
}
