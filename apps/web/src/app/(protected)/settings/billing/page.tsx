import { Suspense } from 'react';
import {
  CurrentPlanSection,
  PaymentMethodsSection,
  BillingHistorySection,
  SectionSkeleton,
} from '@/components/settings/billing';

export default function BillingSettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <CurrentPlanSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <PaymentMethodsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <BillingHistorySection />
      </Suspense>
    </div>
  );
}
