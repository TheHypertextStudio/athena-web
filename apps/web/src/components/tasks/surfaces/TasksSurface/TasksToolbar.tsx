/**
 * Toolbar component for the Tasks surface.
 *
 * Provides filter dropdowns, sort options, search, and create button.
 * Linear-inspired design with filters first, sort, then actions.
 *
 * @packageDocumentation
 */

'use client';

import { useRef, useEffect, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Search, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Task } from '@/lib/api-client';
import { type TaskFilters, type TaskSort, type TaskSortField } from '@/hooks/useTasksSurface';
import { cn } from '@/lib/utils';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

export interface Project {
  id: string;
  name: string;
}

export interface TasksToolbarProps {
  /** Current filter state */
  filters: TaskFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
  /** Current sort state */
  sort: TaskSort;
  /** Callback when sort changes */
  onSortChange: (sort: TaskSort) => void;
  /** Whether search is expanded */
  searchExpanded: boolean;
  /** Callback when search expansion changes */
  onSearchExpandedChange: (expanded: boolean) => void;
  /** Available projects for filtering */
  projects?: Project[];
  /** Whether any filters are active */
  hasActiveFilters?: boolean;
  /** Callback to clear all filters */
  onClearFilters?: () => void;
  /** Additional class name */
  className?: string;
}

const statusOptions: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

const priorityOptions: { value: TaskPriority | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const sortOptions: { value: TaskSortField; label: string }[] = [
  { value: 'none', label: 'Organized' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'priority', label: 'Priority' },
  { value: 'createdAt', label: 'Created' },
  { value: 'updatedAt', label: 'Updated' },
  { value: 'title', label: 'Title' },
];

/**
 * Filter dropdown component.
 */
function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const selectedOption = options.find((o) => o.value === value);
  const isActive = value !== 'all';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="text"
          size="sm"
          className={cn('gap-1', isActive && 'bg-primary/10 text-primary')}
        >
          {isActive ? selectedOption?.label : label}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
            className="flex items-center justify-between"
          >
            {option.label}
            {value === option.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sort dropdown with direction toggle.
 */
function SortDropdown({ sort, onChange }: { sort: TaskSort; onChange: (sort: TaskSort) => void }) {
  const selectedOption = sortOptions.find((o) => o.value === sort.field);
  const isOrganized = sort.field === 'none';

  const handleFieldChange = useCallback(
    (field: TaskSortField) => {
      if (field === sort.field && field !== 'none') {
        // Toggle direction if same field
        onChange({ field, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
      } else {
        onChange({ field, direction: 'asc' });
      }
    },
    [sort, onChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="text"
          size="sm"
          className={cn('gap-1', !isOrganized && 'bg-primary/10 text-primary')}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {selectedOption?.label}
          {!isOrganized &&
            (sort.direction === 'asc' ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            ))}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sortOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              handleFieldChange(option.value);
            }}
            className="flex items-center justify-between"
          >
            <span>{option.label}</span>
            <div className="flex items-center gap-1">
              {sort.field === option.value &&
                option.value !== 'none' &&
                (sort.direction === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                ))}
              {sort.field === option.value && <Check className="h-4 w-4" />}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Expandable search input.
 */
function SearchInput({
  value,
  onChange,
  expanded,
  onExpandedChange,
}: {
  value: string;
  onChange: (value: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleClose = useCallback(() => {
    onChange('');
    onExpandedChange(false);
  }, [onChange, onExpandedChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    },
    [handleClose],
  );

  if (!expanded) {
    return (
      <Button
        variant="text"
        size="icon-sm"
        onClick={() => {
          onExpandedChange(true);
        }}
        aria-label="Search tasks"
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <motion.div
      initial={{ width: 36, opacity: 0.5 }}
      animate={{ width: 200, opacity: 1 }}
      exit={{ width: 36, opacity: 0.5 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="relative"
    >
      <Search className="text-on-surface-variant absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search tasks..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'bg-surface-container-low border-outline-variant',
          'w-full rounded-lg border py-1.5 pr-8 pl-8 text-sm',
          'focus:border-primary focus:ring-primary/30 focus:ring-1 focus:outline-none',
          'transition-colors duration-150',
          'placeholder:text-on-surface-variant/50',
        )}
      />
      <button
        type="button"
        onClick={handleClose}
        className={cn(
          'absolute top-1/2 right-2 -translate-y-1/2',
          'text-on-surface-variant hover:text-on-surface',
          'transition-colors duration-150',
        )}
        aria-label="Close search"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/**
 * Tasks toolbar component.
 */
export const TasksToolbar = memo(function TasksToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  searchExpanded,
  onSearchExpandedChange,
  projects = [],
  hasActiveFilters = false,
  onClearFilters,
  className,
}: TasksToolbarProps) {
  const handleStatusChange = useCallback(
    (value: TaskStatus | 'all') => {
      onFiltersChange((prev) => ({ ...prev, status: value }));
    },
    [onFiltersChange],
  );

  const handlePriorityChange = useCallback(
    (value: TaskPriority | 'all') => {
      onFiltersChange((prev) => ({ ...prev, priority: value }));
    },
    [onFiltersChange],
  );

  const handleProjectChange = useCallback(
    (value: string) => {
      onFiltersChange((prev) => ({ ...prev, projectId: value }));
    },
    [onFiltersChange],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      onFiltersChange((prev) => ({ ...prev, search: value }));
    },
    [onFiltersChange],
  );

  // Build project options
  const projectOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'All' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Filters */}
      <div className="flex items-center gap-1">
        <FilterDropdown
          label="Status"
          value={filters.status ?? 'all'}
          options={statusOptions}
          onChange={handleStatusChange}
        />
        <FilterDropdown
          label="Priority"
          value={filters.priority ?? 'all'}
          options={priorityOptions}
          onChange={handlePriorityChange}
        />
        {projects.length > 0 && (
          <FilterDropdown
            label="Project"
            value={filters.projectId ?? 'all'}
            options={projectOptions}
            onChange={handleProjectChange}
          />
        )}
      </div>

      {/* Sort */}
      <SortDropdown sort={sort} onChange={onSortChange} />

      {/* Clear filters button */}
      <AnimatePresence>
        {hasActiveFilters && onClearFilters && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
          >
            <Button variant="text" size="sm" onClick={onClearFilters}>
              <X className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <AnimatePresence mode="wait">
        <SearchInput
          key={searchExpanded ? 'expanded' : 'collapsed'}
          value={filters.search ?? ''}
          onChange={handleSearchChange}
          expanded={searchExpanded}
          onExpandedChange={onSearchExpandedChange}
        />
      </AnimatePresence>
    </div>
  );
});

export default TasksToolbar;
