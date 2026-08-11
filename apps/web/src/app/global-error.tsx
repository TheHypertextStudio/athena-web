'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import './globals.css';

/**
 * The final application-owned recovery surface when the root layout cannot render.
 *
 * @remarks
 * A route-level failure is handled by `(app)/error.tsx` inside `AppShellFrame`. This boundary is
 * only for failures above that layout, where Next requires a complete document and preserving the
 * existing shell is impossible. It still gives the person a retry and a known-good route instead
 * of exposing Next's full-screen framework error or untrusted failure detail.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): JSX.Element {
  return (
    <html lang="en">
      <body className="bg-surface-container text-on-surface">
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-6 py-12">
          <p className="text-on-surface-variant text-label-large font-medium">Page unavailable</p>
          <h1 className="text-headline-small">Couldn’t load Docket</h1>
          <p className="text-on-surface-variant text-body-large">
            Try again, or return to your work and continue from there.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="bg-primary text-on-primary rounded-md px-4 py-2 font-medium"
            >
              Try again
            </button>
            <Link href="/today" className="text-primary self-center font-medium">
              Go to Today
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
