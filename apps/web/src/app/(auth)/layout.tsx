import { Fraunces } from 'next/font/google';
import type { JSX, ReactNode } from 'react';

/**
 * The marketing display face, loaded for the auth screens' wordmark only — the half-step
 * of the honest seam between the paper-and-ink marketing site and the Plex/MD3 product.
 * `next/font` dedupes this against the (marketing) layout's identical declaration, so the
 * same self-hosted files serve both route groups.
 */
const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

/** Auth route-group layout — publishes the display-face variable for the wordmark. */
export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return <div className={display.variable}>{children}</div>;
}
