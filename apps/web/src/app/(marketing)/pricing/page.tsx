import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ClosingSection } from '@/components/marketing/closing-section';
import { PricingProducts } from '@/components/marketing/pricing-products';

/** Pricing page metadata. */
export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Docket is free to use on your own, and $8 a month for each organization you share work in.',
};

interface Faq {
  question: string;
  answer: string;
}

/**
 * One framing of the price, everywhere: free for one workspace, paid beyond that.
 *
 * @remarks
 * These answers used to contradict the product cards. The cards said the $8 product unlocked multiple
 * workspaces; the FAQ said it triggered when you invited other people. Both cannot be true, and a
 * reader who notices stops believing the rest of the page.
 */
const FAQS: readonly Faq[] = [
  {
    question: 'What does Docket Pro bill?',
    answer:
      'Docket Pro bills each organization separately at $8 a month. It does not charge by member.',
  },
  {
    question: 'How does the trial work?',
    answer:
      'An organization can try Docket Pro for 14 days. Starting checkout again does not add another trial.',
  },
  {
    question: 'When does Docket Pro renew?',
    answer: 'Docket Pro renews monthly on the date shown in organization billing settings.',
  },
  {
    question: 'What happens after cancellation?',
    answer:
      'A personal workspace returns to free Docket and keeps its data. Shared work becomes read-only after the paid period. You can export or reactivate at any time, and Docket does not delete workspace data when Pro ends.',
  },
];

/** Pricing page — products plus a rule-separated FAQ in the editorial register. */
export default function PricingPage(): JSX.Element {
  return (
    <>
      <PricingProducts />
      <section className="border-outline-variant border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="font-display text-ink text-3xl tracking-tight text-balance">
            Billing details
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
