/**
 * `(auth)/_components/auth-feedback` — the shared pending spinner and error alert.
 *
 * @remarks
 * Small presentational pieces shared by both auth screens so pending and error states look
 * and behave identically. {@link AuthError} renders an assertive `role="alert"` region so
 * screen readers announce failures the moment they appear; {@link Spinner} is a decorative,
 * `aria-hidden` indicator paired with visible "…ing" button copy.
 */
import { InlineBanner } from '@docket/ui/components';
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
 * A critical `InlineBanner` announces as an alert the moment it appears, and keeps the failure
 * beside the control that retries it rather than in the notice stack, which the auth screens
 * do not mount.
 */
export function AuthError({ message }: AuthErrorProps): JSX.Element | null {
  if (!message) return null;
  return (
    <InlineBanner tone="critical" density="compact" title={message}>
      {null}
    </InlineBanner>
  );
}
