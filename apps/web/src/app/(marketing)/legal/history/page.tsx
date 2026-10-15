import type { Metadata } from 'next';
import type { JSX } from 'react';

/** Version-history metadata. */
export const metadata: Metadata = {
  title: 'Policy history',
  description: 'Prior Docket terms and privacy policies.',
};

/** Stable links to the complete prior policy documents. */
export default function LegalHistoryPage(): JSX.Element {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-20 pb-24">
      <h1 className="font-display text-ink text-display-small sm:text-display-medium">
        Policy history
      </h1>
      <p className="text-ink-muted text-body-large">
        Read earlier versions of our terms and privacy policy.
      </p>
      <ul className="text-ink flex list-disc flex-col gap-4 pl-5">
        <li>
          <a className="underline" href="/legal/history/terms-2026-08-28">
            Terms effective August 28, 2026
          </a>
        </li>
        <li>
          <a className="underline" href="/legal/history/privacy-2026-09-08">
            Privacy policy effective September 8, 2026
          </a>
        </li>
      </ul>
      <nav aria-label="Current policies" className="text-ink flex flex-wrap gap-6">
        <a className="underline" href="/terms">
          Current terms
        </a>
        <a className="underline" href="/privacy">
          Current privacy policy
        </a>
      </nav>
    </article>
  );
}
