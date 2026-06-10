import { Fraunces } from 'next/font/google';
import type { JSX, ReactNode } from 'react';

/**
 * The marketing display face, loaded for the onboarding wordmark — onboarding sits on the
 * honest seam between the paper-and-ink marketing surface and the Plex/MD3 product, so its
 * brand mark matches the auth screens'. `next/font` dedupes this against the (marketing)
 * and (auth) layouts' identical declarations.
 */
const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'WONK'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

/** Onboarding route layout — publishes the display-face variable for the wordmark. */
export default function OnboardingLayout({ children }: { children: ReactNode }): JSX.Element {
  return <div className={display.variable}>{children}</div>;
}
