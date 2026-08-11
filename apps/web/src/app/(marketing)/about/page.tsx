import type { Metadata } from 'next';
import type { JSX } from 'react';

import { SUPPORT_EMAIL } from '@/lib/support-contact';

/** About page metadata. */
export const metadata: Metadata = {
  title: 'About',
  description: 'What Docket does, who builds it, and how to get in touch.',
};

/**
 * About — three paragraphs and nothing else.
 *
 * @remarks
 * What Docket does, who builds it, and how to reach us. This page previously carried a set of
 * numbered principles under the heading "What we hold to", which is a values statement rather
 * than anything a reader came for.
 */
export default function AboutPage(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-20">
      <h1 className="font-display text-display-large-small text-ink tracking-tight text-balance">
        About Docket
      </h1>
      <div className="text-ink-muted mt-10 flex flex-col gap-6 text-lg leading-relaxed">
        <p>Docket keeps planning, scheduling, and tracked time on the same work records.</p>
        <p>Docket is operated by The Hypertext Studio.</p>
        <p>
          Questions, access requests, and deletion requests can be sent to{' '}
          <a className="text-ink underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
