import { Suspense } from 'react';
import {
  ProviderSelectionSection,
  AvailableProvidersSection,
  SectionSkeleton,
} from '@/components/settings/ai';

export default function AISettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <ProviderSelectionSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <AvailableProvidersSection />
      </Suspense>
    </div>
  );
}
