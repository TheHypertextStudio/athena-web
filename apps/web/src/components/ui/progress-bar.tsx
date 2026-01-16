/**
 * Progress bar component.
 *
 * @packageDocumentation
 */

import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md';
  /** Additional class names for the container */
  className?: string;
}

const sizeStyles = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
};

/**
 * Simple horizontal progress bar.
 *
 * @example
 * ```tsx
 * <ProgressBar progress={43} />
 * <ProgressBar progress={75} size="sm" />
 * <ProgressBar progress={50} size="xs" className="bg-muted" />
 * ```
 */
export function ProgressBar({ progress, size = 'md', className }: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div
      className={cn(
        'bg-surface-container-highest flex w-full overflow-hidden rounded-full',
        sizeStyles[size],
        className,
      )}
    >
      <div
        className="bg-primary transition-all duration-500"
        style={{ width: `${String(clampedProgress)}%` }}
      />
    </div>
  );
}
