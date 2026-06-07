import type { JSX } from 'react';

import { CtaBand } from '@/components/cta-band';
import { FeatureGrid } from '@/components/feature-grid';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { PricingTiers } from '@/components/pricing-tiers';

/**
 * The Docket marketing home page.
 *
 * @remarks
 * A static Server Component that composes the long-scroll landing narrative: hero →
 * features → how-it-works → pricing → closing call-to-action. The shared header and footer
 * come from the root layout. Every section is presentational, so the page renders without a
 * backend.
 */
export default function HomePage(): JSX.Element {
  return (
    <>
      <Hero />
      <FeatureGrid />
      <HowItWorks />
      <PricingTiers />
      <CtaBand />
    </>
  );
}
