import { Check } from '@docket/ui/icons';
import { Button, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { signUpUrl, startDocketProUrl } from '@/lib/marketing-links';

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
    href: startDocketProUrl,
    featured: true,
  },
];

/** Docket products and their current prices. */
export function PricingProducts(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        {/* The marketing register's display face, like every other heading on the site. This one
            heading had been rendering in the app's Plex, two lines above a Fraunces H2. */}
        <Text as="h1" token="display-small" className="font-display text-ink text-balance">
          One price for an organization of any size.
        </Text>
        <Text as="p" token="body-large" tone="muted">
          Each organization is billed on its own.
        </Text>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:max-w-2xl">
        {PRODUCTS.map((product) => (
          <div
            key={product.name}
            className={`bg-paper flex flex-col gap-6 rounded-md border p-6 ${
              product.featured ? 'border-ink' : 'border-outline-variant'
            }`}
          >
            <div className="flex flex-col gap-2">
              <Text as="h2" token="title-large">
                {product.name}
              </Text>
              <div className="flex items-baseline gap-1.5">
                <Text token="display-small" numeric>
                  {product.price}
                </Text>
                {product.cadence ? (
                  <Text token="label-small" tone="muted">
                    {product.cadence}
                  </Text>
                ) : null}
              </div>
              <Text as="p" token="body-medium" tone="muted">
                {product.description}
              </Text>
            </div>
            <ul className="border-outline-variant flex flex-col gap-2.5 border-t pt-5">
              {product.features.map((feature) => (
                <Text as="li" key={feature} token="body-medium" className="flex items-start gap-2">
                  <Check className="text-sienna mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{feature}</span>
                </Text>
              ))}
            </ul>
            <Button
              asChild
              variant={product.featured ? 'default' : 'outline'}
              className="mt-auto w-full"
            >
              <Link
                href={product.href}
                {...(product.href === startDocketProUrl ? { prefetch: false } : {})}
              >
                {product.cta}
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
