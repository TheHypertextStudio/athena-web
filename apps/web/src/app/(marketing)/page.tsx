import type { JSX } from 'react';

import { CtaBand } from '@/components/marketing/cta-band';
import { FeatureLedger } from '@/components/marketing/feature-ledger';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { PricingNote } from '@/components/marketing/pricing-note';
import { PrinciplesStrip } from '@/components/marketing/principles-strip';
import { ProductFrame } from '@/components/marketing/product-frame';
import { SeparationDiagram } from '@/components/marketing/separation-diagram';

/** Marketing home page — editorial narrative: hero → proof → thesis → ledger → path → close. */
export default function HomePage(): JSX.Element {
  return (
    <>
      <Hero />
      <ProductFrame />
      <SeparationDiagram />
      <FeatureLedger />
      <HowItWorks />
      <PrinciplesStrip />
      <PricingNote />
      <CtaBand />
    </>
  );
}
