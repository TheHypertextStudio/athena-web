import { Suspense } from 'react';
import { TaskStatusesSection } from '@/components/settings/workflow';

function SectionSkeleton() {
  return (
    <div className="bg-surface-container animate-pulse rounded-2xl p-6">
      <div className="mb-4">
        <div className="bg-muted h-6 w-32 rounded" />
        <div className="bg-muted mt-2 h-4 w-64 rounded" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-muted h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function WorkflowSettingsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SectionSkeleton />}>
        <TaskStatusesSection />
      </Suspense>
    </div>
  );
}
