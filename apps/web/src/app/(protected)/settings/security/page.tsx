import { Suspense } from 'react';
import {
  SignInMethodsSection,
  PasskeysSection,
  ActiveSessionsSection,
  AccountRecoverySection,
  ConnectedDevicesSection,
  SectionSkeleton,
} from '@/components/settings/security';

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <SignInMethodsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <PasskeysSection />
      </Suspense>

      <ConnectedDevicesSection />

      <Suspense fallback={<SectionSkeleton />}>
        <ActiveSessionsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <AccountRecoverySection />
      </Suspense>
    </div>
  );
}
