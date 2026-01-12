/**
 * Loading skeleton for the integration detail page.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function IntegrationDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-32" />
      <div className="bg-surface-container rounded-xl p-6">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
          <Skeleton className="h-16 w-full" />
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
