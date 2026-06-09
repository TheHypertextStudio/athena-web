import { Check } from '@docket/ui/icons';
import {
  Badge,
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
    name: 'Personal',
    price: '$0',
    cadence: 'free forever',
    description: 'Your own command center for everything you run solo.',
    features: [
      'Your personal space + one organization',
      'Unlimited projects and tasks',
      'Cross-organization Today view',
      'Connect your own tools',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Team',
    price: '$8',
    cadence: 'per user / month',
    description: 'For organizations with a few people moving work together.',
    features: [
      'Everything in Personal',
      'Unlimited organizations and members',
      'Roles, permissions, and guests',
      'Agent sessions with approval gates',
      'Priority support',
    ],
    cta: 'Start a free trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: "let's talk",
    description: 'For larger groups that need SSO, provisioning, and controls.',
    features: [
      'Everything in Team',
      'SSO and directory provisioning',
      'Advanced audit and lifecycle controls',
      'Dedicated onboarding',
    ],
    cta: 'Contact us',
  },
];

export function PricingTiers(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <span className="text-primary text-sm font-medium">Pricing</span>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Free for one of you, fair for all of you
        </h2>
        <p className="text-muted-foreground text-balance">
          Start free with your personal command center. Add a card only when you bring other people
          into a shared organization.
        </p>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <Card
            key={tier.name}
            className={
              tier.featured ? 'border-primary ring-primary/20 relative shadow-lg ring-1' : undefined
            }
          >
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                {tier.featured ? <Badge>Most popular</Badge> : null}
              </div>
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
