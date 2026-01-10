import { Suspense } from 'react';
import {
  IntegrationsListSection,
  IntegrationsListSkeleton,
} from '@/components/settings/integrations';

export default function IntegrationsSettingsPage() {
  return (
    <Suspense fallback={<IntegrationsListSkeleton />}>
      <IntegrationsListSection />
    </Suspense>
  );
}
