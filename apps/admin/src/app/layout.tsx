import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

import './globals.css';

/**
 * Root layout for the Docket service-admin console.
 *
 * @remarks
 * Imports the design-token stylesheet (`@docket/ui` globals, re-exported by
 * `./globals.css`) and mounts the global client {@link Providers} (theme, impersonation)
 * around every route. The per-section layouts decide whether to render the operator shell:
 * the `(admin)` route group wraps its pages in `AdminShell`, while `/sign-in` stays bare.
 * `suppressHydrationWarning` on `<html>` is required by `next-themes`, which sets the theme
 * class on the client before hydration.
 */
export const metadata = {
  title: 'Docket Admin',
  description: 'Docket service-admin console.',
};

/** The App Router root layout wrapping every page in the service-admin app. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
