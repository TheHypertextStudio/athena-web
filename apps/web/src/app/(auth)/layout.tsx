import type { JSX, ReactNode } from 'react';

import { preloadDisplayFonts } from '@/lib/fonts';
import '../fraunces.css';

/** Auth route-group layout — publishes the display-face variable for the wordmark. */
export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  preloadDisplayFonts();
  return <div className="docket-font-display">{children}</div>;
}
