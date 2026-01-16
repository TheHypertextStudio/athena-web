/**
 * Initiative detail modal component.
 *
 * Lightweight detail view for contextual access to initiatives
 * via route interception modal pattern.
 *
 * @packageDocumentation
 */

'use client';

import CloseOutlined from '@mui/icons-material/CloseOutlined';
import FullscreenOutlined from '@mui/icons-material/FullscreenOutlined';
import GpsFixedOutlined from '@mui/icons-material/GpsFixedOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CustomInitiativeStatusBadge } from './initiative-status-select';
import type { Initiative } from '@/lib/api-client';

export interface InitiativeDetailModalProps {
  /** The initiative to display */
  initiative: Initiative | null;
  /** Whether the data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback to expand to full page */
  onExpand: () => void;
  /** Progress percentage (calculated externally) */
  progress?: number;
  /** Task counts */
  taskCounts?: {
    total: number;
    completed: number;
  };
  /** Project count */
  projectCount?: number;
}

/**
 * Initiative detail modal component.
 *
 * @example
 * ```tsx
 * <InitiativeDetailModal
 *   initiative={initiative}
 *   isLoading={false}
 *   error={null}
 *   onClose={() => router.back()}
 *   onExpand={() => router.push(`/initiatives/${id}`)}
 * />
 * ```
 */
export function InitiativeDetailModal({
  initiative,
  isLoading,
  error,
  onClose,
  onExpand,
  progress = 0,
  taskCounts,
  projectCount = 0,
}: InitiativeDetailModalProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="bg-surface-container rounded-2xl p-6">
        <div className="flex items-center justify-center py-12">
          <SyncOutlined sx={{ fontSize: 32 }} className="text-primary animate-spin" />
        </div>
      </div>
    );
  }

  // Error state
  if (error || !initiative) {
    return (
      <div className="bg-surface-container rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="text-error flex items-center gap-2">
            <ErrorOutlineOutlined sx={{ fontSize: 20 }} />
            <span className="font-medium">Failed to load initiative</span>
          </div>
          <Button variant="text" size="icon" onClick={onClose}>
            <CloseOutlined sx={{ fontSize: 20 }} />
          </Button>
        </div>
        <p className="text-on-surface-variant mt-2 text-sm">{error ?? 'Initiative not found'}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container rounded-2xl shadow-xl">
      {/* Header */}
      <div className="border-outline-variant flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
            <GpsFixedOutlined sx={{ fontSize: 20 }} className="text-primary" />
          </div>
          <div>
            <h2 className="text-on-surface font-semibold">{initiative.name}</h2>
            <CustomInitiativeStatusBadge status={initiative.customStatus} size="small" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="text" size="icon" onClick={onExpand} title="Expand to full page">
            <FullscreenOutlined sx={{ fontSize: 16 }} />
          </Button>
          <Button variant="text" size="icon" onClick={onClose} title="Close">
            <CloseOutlined sx={{ fontSize: 20 }} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4 p-4">
        {/* Description */}
        {initiative.description && (
          <p className="text-on-surface-variant line-clamp-3 text-sm">{initiative.description}</p>
        )}

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-on-surface-variant">Progress</span>
            <span className="font-medium tabular-nums">{progress}%</span>
          </div>
          <ProgressBar progress={progress} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-container-high rounded-lg p-3">
            <div className="text-on-surface text-2xl font-bold tabular-nums">{projectCount}</div>
            <div className="text-on-surface-variant text-xs">Projects</div>
          </div>
          <div className="bg-surface-container-high rounded-lg p-3">
            <div className="text-on-surface text-2xl font-bold tabular-nums">
              {taskCounts?.completed ?? 0}/{taskCounts?.total ?? 0}
            </div>
            <div className="text-on-surface-variant text-xs">Tasks completed</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-outline-variant border-t p-4">
        <Button asChild className="w-full">
          <Link href={`/initiatives/${initiative.id}`}>View Full Details</Link>
        </Button>
      </div>
    </div>
  );
}
