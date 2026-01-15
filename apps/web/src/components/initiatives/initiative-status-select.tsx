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
import {
  useInitiativeStatuses,
  type CustomInitiativeStatus,
} from '@/hooks/use-initiative-statuses';
import { cn } from '@/lib/utils';

interface InitiativeStatusSelectProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Status badge component for displaying a custom initiative status with its color.
 * This is for user-defined statuses from the database, not the hardcoded status enum.
 */
export function CustomInitiativeStatusBadge({
  status,
  size = 'default',
}: {
  status: CustomInitiativeStatus | null | undefined;
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

const CATEGORY_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

/**
 * Initiative status select dropdown with statuses grouped by category.
 */
export function InitiativeStatusSelect({
  value,
  onChange,
  disabled,
  className,
  placeholder = 'Select status',
}: InitiativeStatusSelectProps) {
  const { statuses, isLoading } = useInitiativeStatuses();

  // Group statuses by category for the dropdown
  const groupedStatuses = useMemo(() => {
    return {
      planning: statuses.filter((s) => s.category === 'planning'),
      active: statuses.filter((s) => s.category === 'active'),
      completed: statuses.filter((s) => s.category === 'completed'),
      archived: statuses.filter((s) => s.category === 'archived'),
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
          {currentStatus && <CustomInitiativeStatusBadge status={currentStatus} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedStatuses).map(([category, categoryStatuses]) =>
          categoryStatuses.length > 0 ? (
            <SelectGroup key={category}>
              <SelectLabel>{CATEGORY_LABELS[category] ?? category}</SelectLabel>
              {categoryStatuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  <CustomInitiativeStatusBadge status={status} />
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
export function InitiativeStatusIndicator({
  status,
  showLabel = false,
}: {
  status: CustomInitiativeStatus | null | undefined;
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
export function InitiativeStatusChip({
  status,
  onClick,
  selected,
}: {
  status: CustomInitiativeStatus;
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
