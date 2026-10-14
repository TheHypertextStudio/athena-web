import type { JSX, ReactNode } from 'react';

import { LEGAL_ADDRESS, LEGAL_EMAIL, LEGAL_HISTORY_PATH, LEGAL_OPERATOR } from '@/lib/legal-policy';
import { CONTACT_EMAIL, SUPPORT_EMAIL } from '@/lib/support-contact';

/** A policy section with an accessible heading and readable body. */
export interface LegalPolicySection {
  readonly title: string;
  readonly body: ReactNode;
}

/** Shared public policy layout, dates, and stable version-history navigation. */
export function LegalPolicyDocument({
  title,
  dates,
  sections,
}: {
  readonly title: string;
  readonly dates: ReactNode;
  readonly sections: readonly LegalPolicySection[];
}): JSX.Element {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-20 pb-24">
      <header>
        <p className="text-ink-muted text-label-large">Legal</p>
        <h1 className="font-display text-ink text-display-small sm:text-display-medium mt-4">
          {title}
        </h1>
        <div className="text-ink-muted text-body-large mt-4 flex flex-col gap-3">{dates}</div>
        <a className="text-ink mt-4 inline-block underline" href={LEGAL_HISTORY_PATH}>
          Prior policy versions
        </a>
      </header>
      {sections.map(({ title: sectionTitle, body }) => (
        <section key={sectionTitle} className="flex flex-col gap-3 pt-7">
          <h2 className="font-display text-ink text-headline-small">{sectionTitle}</h2>
          <div className="text-ink-muted text-body-large flex flex-col gap-3">{body}</div>
        </section>
      ))}
    </article>
  );
}

/** Shared official contact details, with product support kept separate. */
export function LegalPolicyContact(): JSX.Element {
  return (
    <>
      <p>
        For legal notices or privacy requests, contact{' '}
        <a className="text-ink underline" href={`mailto:${LEGAL_EMAIL}`}>
          {LEGAL_EMAIL}
        </a>
        .
      </p>
      <p>
        {LEGAL_OPERATOR}, {LEGAL_ADDRESS}, United States.
      </p>
      <p>
        For general inquiries, contact{' '}
        <a className="text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      <p>
        For product help, contact{' '}
        <a className="text-ink underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </>
  );
}
