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
import type { JSX } from 'react';

import { signUpUrl } from '@/lib/links';

/** One pricing plan rendered as a card. */
interface Tier {
  /** The plan's name. */
  name: string;
  /** The headline price (already formatted for display). */
  price: string;
  /** The cadence/qualifier shown beneath the price (e.g. "per user / month"). */
  cadence: string;
  /** A one-line description of who the plan is for. */
  description: string;
  /** The plan's included capabilities, in display order. */
  features: readonly string[];
  /** The card's call-to-action label. */
  cta: string;
  /** Whether to visually emphasize this plan as the recommended one. */
  featured?: boolean;
}

/**
 * The available plans, in display order.
 *
 * @remarks
 * Prices are representative placeholder values — the real catalog is configured in Stripe
 * per environment. They exist so the page renders a complete, believable pricing story.
 */
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
    cadence: 'let’s talk',
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

/**
 * The pricing section: a short header and a three-up grid of plan cards.
 *
 * @remarks
 * A Server Component reused on both the home page and the dedicated `/pricing` route. Every
 * plan's call-to-action routes to {@link signUpUrl}; the "Team" plan is emphasized as the
 * recommended choice. Anchored as `#pricing` for in-site links.
 */
export function PricingTiers(): JSX.Element {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <span className="text-primary text-sm font-medium">Pricing</span>
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
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
                <a href={signUpUrl}>{tier.cta}</a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
