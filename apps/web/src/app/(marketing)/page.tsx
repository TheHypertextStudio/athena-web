import type { JSX } from 'react';

import { CtaBand } from '@/components/marketing/cta-band';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { PricingTiers } from '@/components/marketing/pricing-tiers';

/** Marketing home page. */
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
