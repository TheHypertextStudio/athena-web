'use client';

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomStatuses, type CustomTaskStatus } from '@/hooks/use-custom-statuses';
import { cn } from '@/lib/utils';

interface TaskStatusSelectProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Status badge component for displaying a task status with its color.
 */
export function StatusBadge({
  status,
  size = 'default',
}: {
  status: CustomTaskStatus | null | undefined;
  size?: 'default' | 'small';
}) {
  if (!status) return null;

  return (
    <span className="flex items-center gap-2">
      <span
        className={cn('rounded-full', size === 'small' ? 'h-2 w-2' : 'h-2.5 w-2.5')}
        style={{ backgroundColor: status.color }}
      />
      <span className={cn(size === 'small' && 'text-xs')}>{status.name}</span>
    </span>
  );
}

/**
 * Task status select dropdown with statuses grouped by category.
 */
export function TaskStatusSelect({
  value,
  onChange,
  disabled,
  className,
  placeholder = 'Select status',
}: TaskStatusSelectProps) {
  const { statuses, isLoading } = useCustomStatuses();

  // Group statuses by category for the dropdown
  const groupedStatuses = useMemo(() => {
    return {
      'Not Started': statuses.filter((s) => s.category === 'not_started'),
      'In Progress': statuses.filter((s) => s.category === 'in_progress'),
      Done: statuses.filter((s) => s.category === 'done'),
      Cancelled: statuses.filter((s) => s.category === 'cancelled'),
    };
  }, [statuses]);

  const currentStatus = statuses.find((s) => s.id === value);

  if (isLoading) {
    return <div className={cn('bg-muted h-10 w-full animate-pulse rounded-md', className)} />;
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder}>
          {currentStatus && <StatusBadge status={currentStatus} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedStatuses).map(([category, categoryStatuses]) =>
          categoryStatuses.length > 0 ? (
            <SelectGroup key={category}>
              <SelectLabel>{category}</SelectLabel>
              {categoryStatuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  <StatusBadge status={status} />
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null,
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * Compact status indicator for use in lists and cards.
 */
export function StatusIndicator({
  status,
  showLabel = false,
}: {
  status: CustomTaskStatus | null | undefined;
  showLabel?: boolean;
}) {
  if (!status) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: status.color }}
        title={status.name}
      />
      {showLabel && <span className="text-muted-foreground text-xs">{status.name}</span>}
    </span>
  );
}

/**
 * Status chip for filtering and display.
 */
export function StatusChip({
  status,
  onClick,
  selected,
}: {
  status: CustomTaskStatus;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80',
      )}
      style={selected ? { backgroundColor: status.color, color: 'white' } : undefined}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: selected ? 'white' : status.color }}
      />
      {status.name}
    </button>
  );
}
