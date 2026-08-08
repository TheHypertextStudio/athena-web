import { Check } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signUpUrl } from '@/lib/marketing-links';

interface Tier {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: readonly string[];
  cta: string;
  featured?: boolean;
}

const TIERS: readonly Tier[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    description: 'One workspace, no card required.',
    features: [
      'One workspace',
      'Unlimited projects and tasks',
      'Connect your own tools',
      'MCP access for AI clients',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Pro',
    price: '$8',
    cadence: 'per month',
    description: 'For individuals running more than one workspace.',
    features: ['Everything in Free', 'Multiple workspaces', 'Priority support'],
    cta: 'Start free trial',
    featured: true,
  },
];

/**
 * Pricing tiers in the paper-and-ink register — bordered paper panels with Fraunces
 * tier names and prices; the featured tier earns the plate shadow instead of a glow ring.
 */
export function PricingTiers(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-display text-display-large-small text-ink tracking-tight text-balance">
          Free until you run more than one workspace.
        </h1>
        <p className="text-ink-muted text-lg text-balance">
          A workspace is one organization, with its own people, settings, and connected tools. The
          first one costs nothing. Pro adds the rest.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:max-w-2xl">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`bg-paper flex flex-col gap-6 rounded-md border p-6 ${
              tier.featured ? 'border-ink shadow-plate' : 'border-outline-variant'
            }`}
          >
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-ink text-2xl tracking-tight">{tier.name}</h2>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-ink text-4xl tracking-tight">{tier.price}</span>
                <span className="text-ink-muted font-mono text-xs">{tier.cadence}</span>
              </div>
              <p className="text-ink-muted text-body-medium">{tier.description}</p>
            </div>
            <ul className="border-outline-variant flex flex-col gap-2.5 border-t pt-5">
              {tier.features.map((feature) => (
                <li key={feature} className="text-body-medium text-ink flex items-start gap-2">
                  <Check className="text-sienna mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              variant={tier.featured ? 'default' : 'outline'}
              className="mt-auto w-full"
            >
              <Link href={signUpUrl}>{tier.cta}</Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
