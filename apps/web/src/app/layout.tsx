import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

import './globals.css';

/**
 * Root layout for the Docket product app.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and mounts the global client {@link Providers} (theme, active context,
 * vocabulary) around every route. `suppressHydrationWarning` on `<html>` is required by
 * `next-themes`, which sets the theme class on the client before hydration.
 */
export const metadata = {
  title: 'Docket',
  description: 'Docket — the calm command center for work.',
};

/** The App Router root layout wrapping every page in the product app. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
