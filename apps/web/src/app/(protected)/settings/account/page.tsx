import { Suspense } from 'react';
import {
  ProfileSection,
  PreferencesSection,
  AccountOverviewSection,
  SectionSkeleton,
} from '@/components/settings/account';

export default function AccountSettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <ProfileSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <PreferencesSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <AccountOverviewSection />
      </Suspense>
    </div>
  );
}
