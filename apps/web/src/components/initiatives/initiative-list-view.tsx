/**
 * Initiative list view component.
 *
 * Container component for displaying and filtering initiatives.
 * Includes toolbar with status filters and empty state handling.
 *
 * @packageDocumentation
 */

'use client';

import { useMemo, useState } from 'react';
import { Plus, Target, Filter } from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { InitiativeListItem, type InitiativeWithMetrics } from './initiative-list-item';
import { cn } from '@/lib/utils';
import type { InitiativeStatusCategory } from '@/lib/api-client';

const STATUS_OPTIONS: { value: InitiativeStatusCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'planning', label: 'Planning' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export interface InitiativeListViewProps {
  /** Initiatives to display */
  initiatives: InitiativeWithMetrics[];
  /** Whether data is loading */
  isLoading?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Empty state component for when no initiatives exist.
 */
function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-surface-container-high flex h-16 w-16 items-center justify-center rounded-full">
          <Filter className="text-on-surface-variant h-8 w-8" />
        </div>
        <h3 className="text-on-surface mt-4 text-lg font-semibold">No matching initiatives</h3>
        <p className="text-on-surface-variant mt-1 text-sm">
          Try adjusting your filters to see more results.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
        <Target className="text-primary h-8 w-8" />
      </div>
      <h3 className="text-on-surface mt-4 text-lg font-semibold">No initiatives yet</h3>
      <p className="text-on-surface-variant mt-1 max-w-sm text-sm">
        Initiatives are strategic goals that organize your projects. Create your first initiative to
        start tracking your high-level objectives.
      </p>
      <Button asChild className="mt-6">
        <Link href="/initiatives/new">
          <Plus className="mr-2 h-4 w-4" />
          Create Initiative
        </Link>
      </Button>
    </div>
  );
}

/**
 * Status filter chip component.
 */
function StatusFilterChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary text-on-primary'
          : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Initiative list view component.
 *
 * Displays initiatives in a grid/list with filtering by status.
 *
 * @example
 * ```tsx
 * <InitiativeListView initiatives={initiatives} />
 * ```
 */
export function InitiativeListView({ initiatives, className }: InitiativeListViewProps) {
  const [statusFilter, setStatusFilter] = useState<InitiativeStatusCategory | 'all'>('all');

  // Filter initiatives by status category
  const filteredInitiatives = useMemo(() => {
    if (statusFilter === 'all') {
      return initiatives;
    }
    return initiatives.filter((i) => i.statusCategory === statusFilter);
  }, [initiatives, statusFilter]);

  // Group by status category for organized display when showing all
  const groupedInitiatives = useMemo(() => {
    if (statusFilter !== 'all') {
      return { [statusFilter]: filteredInitiatives };
    }

    const groups: Record<InitiativeStatusCategory, InitiativeWithMetrics[]> = {
      active: [],
      planning: [],
      completed: [],
      archived: [],
    };

    for (const initiative of filteredInitiatives) {
      const category = initiative.statusCategory ?? 'planning';
      groups[category].push(initiative);
    }

    return groups;
  }, [filteredInitiatives, statusFilter]);

  const hasAnyInitiatives = initiatives.length > 0;
  const hasFilteredResults = filteredInitiatives.length > 0;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-on-surface text-2xl font-bold">Initiatives</h1>
        {hasAnyInitiatives && (
          <Button asChild>
            <Link href="/initiatives/new">
              <Plus className="mr-2 h-4 w-4" />
              New Initiative
            </Link>
          </Button>
        )}
      </div>

      {/* Status filters */}
      {hasAnyInitiatives && (
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <StatusFilterChip
              key={option.value}
              label={option.label}
              isActive={statusFilter === option.value}
              onClick={() => {
                setStatusFilter(option.value);
              }}
            />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {!hasAnyInitiatives || !hasFilteredResults ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <EmptyState hasFilter={hasAnyInitiatives && !hasFilteredResults} />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {statusFilter === 'all' ? (
                // Show grouped by status
                Object.entries(groupedInitiatives).map(([status, items]) => {
                  if (items.length === 0) return null;
                  return (
                    <section key={status}>
                      <h2 className="text-on-surface-variant mb-3 text-sm font-medium tracking-wide uppercase">
                        {status} ({items.length})
                      </h2>
                      <div className="space-y-3">
                        {items.map((initiative) => (
                          <InitiativeListItem key={initiative.id} initiative={initiative} />
                        ))}
                      </div>
                    </section>
                  );
                })
              ) : (
                // Show flat list when filtered
                <div className="space-y-3">
                  {filteredInitiatives.map((initiative) => (
                    <InitiativeListItem key={initiative.id} initiative={initiative} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
