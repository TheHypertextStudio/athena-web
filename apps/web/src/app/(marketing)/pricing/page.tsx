import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ClosingSection } from '@/components/marketing/closing-section';
import { PricingTiers } from '@/components/marketing/pricing-tiers';

/** Pricing page metadata. */
export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Docket is free for one workspace. You pay when you run more than one.',
};

interface Faq {
  question: string;
  answer: string;
}

/**
 * One framing of the price, everywhere: free for one workspace, paid beyond that.
 *
 * @remarks
 * These answers used to contradict the tier cards. The cards said the $8 unlocked multiple
 * workspaces; the FAQ said it triggered when you invited other people. Both cannot be true, and a
 * reader who notices stops believing the rest of the page.
 */
const FAQS: readonly Faq[] = [
  {
    question: 'Do I need a credit card to start?',
    answer:
      'No. One workspace is free with no card required. You add billing when you want to run more than one from the same account.',
  },
  {
    question: 'What counts as a workspace?',
    answer:
      'One organization, with its own people, settings, and connected tools. Your personal space is a workspace too, and it is the free one.',
  },
  {
    question: 'Is there a discount for nonprofits?',
    answer: 'Yes — reach out and we will sort out nonprofit pricing for your organization.',
  },
];

/** Pricing page — tiers plus rule-separated FAQ in the editorial register. */
export default function PricingPage(): JSX.Element {
  return (
    <>
      <PricingTiers />
      <section className="border-outline-variant border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="font-display text-ink text-3xl tracking-tight text-balance">
            Questions, answered
          </h2>
          <dl className="divide-outline-variant mt-8 flex flex-col divide-y">
            {FAQS.map((faq) => (
              <div key={faq.question} className="flex flex-col gap-2 py-6">
                <dt className="font-display text-ink text-xl tracking-tight">{faq.question}</dt>
                <dd className="text-ink-muted text-base">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <ClosingSection pricing={false} />
    </>
  );
}
