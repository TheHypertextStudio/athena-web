import type { JSX, ReactNode } from 'react';

import { preloadDisplayFonts } from '@/lib/fonts';
import '../fraunces.css';

/** Onboarding route layout — publishes the display-face variable for the wordmark. */
export default function OnboardingLayout({ children }: { children: ReactNode }): JSX.Element {
  preloadDisplayFonts();
  return <div className="docket-font-display">{children}</div>;
}
