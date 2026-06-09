import { Check } from '@docket/ui/icons';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@docket/ui/primitives';
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
    description: 'Your personal command center. No card required.',
    features: [
      'One personal workspace',
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

export function PricingTiers(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <span className="text-primary text-sm font-medium">Pricing</span>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Free until you need more than one workspace
        </h2>
        <p className="text-muted-foreground text-balance">
          Start with your personal space at no cost. Upgrade to Pro when you want to run multiple
          workspaces from the same account.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:max-w-2xl">
        {TIERS.map((tier) => (
          <Card
            key={tier.name}
            className={
              tier.featured ? 'border-primary ring-primary/20 relative shadow-lg ring-1' : undefined
            }
          >
            <CardHeader className="gap-2">
              <CardTitle className="text-lg">{tier.name}</CardTitle>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight">{tier.price}</span>
                <span className="text-muted-foreground text-sm">{tier.cadence}</span>
              </div>
              <CardDescription>{tier.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <ul className="flex flex-col gap-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant={tier.featured ? 'default' : 'outline'} className="w-full">
                <Link href={signUpUrl}>{tier.cta}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
