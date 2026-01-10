import { Skeleton } from '@/components/ui/skeleton';

export function IntegrationsListSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((category) => (
        <div key={category} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-[72px] w-full rounded-xl" />
            <Skeleton className="h-[72px] w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
