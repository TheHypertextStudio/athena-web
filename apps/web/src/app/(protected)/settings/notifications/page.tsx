import { Suspense } from 'react';
import {
  ChannelsSection,
  QuietHoursSection,
  NotificationTypesSection,
  SectionSkeleton,
} from '@/components/settings/notifications';

export default function NotificationsSettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <ChannelsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <QuietHoursSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <NotificationTypesSection />
      </Suspense>
    </div>
  );
}
