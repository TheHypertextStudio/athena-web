import { Check } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { openAppUrl, signUpUrl } from '@/lib/marketing-links';

interface Product {
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly cta: string;
  readonly href: string;
  readonly featured?: boolean;
}

const PRODUCTS: readonly Product[] = [
  {
    name: 'Docket',
    price: 'Free',
    cadence: '',
    description: 'One personal workspace with planning, scheduling, and time tracking.',
    features: ['Planning', 'Scheduling', 'Time tracking'],
    cta: 'Create free account',
    href: signUpUrl,
  },
  {
    name: 'Docket Pro',
    price: '$8',
    cadence: 'per organization each month',
    description: 'Shared work, integrations, MCP, and current Athena functionality.',
    features: ['Shared work', 'Integrations', 'MCP', 'Athena and voice'],
    cta: 'Add Docket Pro',
    href: openAppUrl,
    featured: true,
  },
];

/** Docket products and their current prices. */
export function PricingProducts(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-display text-display-large-small text-ink tracking-tight text-balance">
          Docket is free. Docket Pro is $8 a month.
        </h1>
        <p className="text-ink-muted text-lg text-balance">
          Docket Pro is billed separately for each organization that uses it.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:max-w-2xl">
        {PRODUCTS.map((product) => (
          <div
            key={product.name}
            className={`bg-paper flex flex-col gap-6 rounded-md border p-6 ${
              product.featured ? 'border-ink shadow-plate' : 'border-outline-variant'
            }`}
          >
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-ink text-2xl tracking-tight">{product.name}</h2>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-ink text-4xl tracking-tight">
                  {product.price}
                </span>
                {product.cadence ? (
                  <span className="text-ink-muted font-mono text-xs">{product.cadence}</span>
                ) : null}
              </div>
              <p className="text-ink-muted text-body-medium">{product.description}</p>
            </div>
            <ul className="border-outline-variant flex flex-col gap-2.5 border-t pt-5">
              {product.features.map((feature) => (
                <li key={feature} className="text-body-medium text-ink flex items-start gap-2">
                  <Check className="text-sienna mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              variant={product.featured ? 'default' : 'outline'}
              className="mt-auto w-full"
            >
              <Link href={product.href} prefetch={product.href === openAppUrl ? false : undefined}>
                {product.cta}
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
