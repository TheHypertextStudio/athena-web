import Link from 'next/link';
import type { JSX } from 'react';

/**
 * The root missing-route boundary.
 *
 * @remarks
 * Next includes this boundary in every route's client graph, so it must stay independent of the
 * authenticated application shell. Importing `AppShellFrame` here made sign-in and onboarding
 * compile the complete editor, picker, calendar, and action-domain graph before navigation could
 * finish. Missing records inside authenticated routes retain their scoped `(app)/not-found.tsx`;
 * a genuinely unresolved URL receives this small, useful recovery page.
 */
export default function RootNotFound(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-3 px-6 py-12">
      <p className="text-on-surface-variant text-label-large">404</p>
      <h1 className="text-on-surface text-headline-small">This page isn’t available</h1>
      <p className="text-on-surface-variant text-body-large">
        The address may be mistyped, or the page may no longer exist.
      </p>
      <Link href="/" className="text-primary text-body-medium mt-2 w-fit">
        Go to Docket home
      </Link>
    </main>
  );
}
