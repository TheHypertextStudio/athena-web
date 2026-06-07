import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CtaBand } from '@/components/cta-band';
import { PricingTiers } from '@/components/pricing-tiers';

/** Page-specific metadata for the pricing route. */
export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Docket is free for your personal command center. Pay only when you bring people into a shared organization.',
};

/** One frequently-asked question and its plain-language answer. */
interface Faq {
  /** The question. */
  question: string;
  /** The answer. */
  answer: string;
}

/** The pricing-page FAQs, in display order. */
const FAQS: readonly Faq[] = [
  {
    question: 'Do I need a credit card to start?',
    answer:
      'No. Your personal command center and your first organization are free, with no card required. You only add billing when you invite other people into a shared organization.',
  },
  {
    question: 'How does billing work across organizations?',
    answer:
      'Billing is per organization, so each venture you run is charged on its own — handy when a startup and a nonprofit live side by side in your Docket.',
  },
  {
    question: 'What happens when my trial ends?',
    answer:
      'If you do not continue, your work stays exportable for a grace period before anything is removed, so you are never locked out of your own data.',
  },
  {
    question: 'Is there a discount for nonprofits?',
    answer: 'Yes — reach out and we will sort out nonprofit pricing for your organization.',
  },
];

/**
 * The dedicated pricing page: the full plan grid followed by a short FAQ and a closing
 * call-to-action.
 *
 * @remarks
 * A static Server Component. The plan cards are shared with the home page via
 * {@link PricingTiers}; this route adds the FAQ for buyers who want the details before
 * signing up.
 */
export default function PricingPage(): JSX.Element {
  return (
    <>
      <PricingTiers />
      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Questions, answered
        </h2>
        <dl className="divide-border/60 mt-8 flex flex-col divide-y">
          {FAQS.map((faq) => (
            <div key={faq.question} className="flex flex-col gap-2 py-6">
              <dt className="text-base font-semibold">{faq.question}</dt>
              <dd className="text-muted-foreground text-sm">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
      <CtaBand />
    </>
  );
}
