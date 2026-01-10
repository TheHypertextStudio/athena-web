import { Skeleton } from '@/components/ui/skeleton';

export function SectionSkeleton() {
  return (
    <div className="bg-surface-container rounded-lg p-4">
      <Skeleton className="mb-2 h-5 w-32" />
      <Skeleton className="mb-4 h-4 w-48" />
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
