import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

/**
 * The public landing page for the Docket product app.
 *
 * @remarks
 * A static, token-styled hero (a Server Component — it neither reads the session nor
 * touches the API, so it renders without a running backend). The two calls-to-action route
 * to the email/password auth screens; the app shell and authenticated flows live behind
 * them.
 */
export default function HomePage(): JSX.Element {
  return (
    <main className="bg-surface text-on-surface flex min-h-screen flex-col items-center justify-center px-6">
      <section className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <span className="border-outline-variant text-on-surface-variant rounded-full border px-3 py-1 text-xs font-medium">
          The calm command center for work
        </span>

        <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">Docket</h1>

        <p className="text-on-surface-variant max-w-xl text-lg text-balance">
          One home for everything you run. Plan your day, keep work moving, and let the noise
          settle.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="dark:border-outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
