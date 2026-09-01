import type {
  InitiativeViewRow,
  ProgramViewRow,
  ProjectViewRow,
  TaskViewRow,
  WorkViewGroup,
} from '@docket/work/work-view-contract';
import type { ViewTarget } from '@docket/work/view-contract';
import { formatCalendarDate } from '@/lib/format-date';

/** Target-indexed row projection consumed by shared roster renderers. */
export interface WorkViewRowByTarget {
  readonly task: TaskViewRow;
  readonly project: ProjectViewRow;
  readonly program: ProgramViewRow;
  readonly initiative: InitiativeViewRow;
}

/** One target-correlated row projection. */
export type WorkViewRowFor<TTarget extends ViewTarget> = WorkViewRowByTarget[TTarget];

/** One independently paginated server group or subgroup. */
export interface WorkViewGroupPage<TTarget extends ViewTarget> {
  readonly path: readonly string[];
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly nextCursor: string | null;
  readonly loading: boolean;
  /** The failed cursor stays with its path so the owning continuation can retry it. */
  readonly retryCursor?: string | null;
  /** The owning continuation renders application-owned recovery copy for this failure. */
  readonly error?: unknown;
}

/** Group summary returned by the root query. */
export type WorkViewGroupSummary = WorkViewGroup;

/** Resolve the display title from one target-discriminated row. */
export function workViewRowTitle(row: WorkViewRowFor<ViewTarget>): string {
  switch (row.target) {
    case 'task':
      return row.title;
    case 'project':
    case 'program':
    case 'initiative':
      return row.name;
  }
}

/** Resolve a projected field without weakening callers to `any`. */
export function workViewRowValue(row: WorkViewRowFor<ViewTarget>, field: string): unknown {
  return (row as unknown as Readonly<Record<string, unknown>>)[field];
}

/** Resolve display-only relation projections while preserving raw values for other fields. */
export function workViewRowDisplayValue(row: WorkViewRowFor<ViewTarget>, field: string): unknown {
  if (row.target === 'task' && field === 'assignee') return row.assigneeActor;
  if (row.target === 'project' && field === 'lead') return row.leadActor;
  if (row.target === 'program' && field === 'owner') return row.ownerActor;
  if (row.target === 'initiative' && field === 'owner') return row.ownerActor;
  return workViewRowValue(row, field);
}

/**
 * Day plus time, for a `datetime` field.
 *
 * @remarks
 * A `datetime` carries an instant, and two of them on the same day are a different fact from one.
 * Formatting `updatedAt` as a bare calendar day would make a record touched at 09:00 and again at
 * 17:00 read identically, which is exactly what the column exists to tell apart.
 */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** Format a projected scalar or relation value for a compact row or card. */
export function formatWorkViewValue(value: unknown, kind?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (
    typeof value === 'object' &&
    'displayName' in value &&
    typeof value.displayName === 'string'
  ) {
    return value.displayName;
  }
  if (typeof value === 'object' && 'label' in value && typeof value.label === 'string') {
    return value.label;
  }
  if (kind === 'relation-one') return '—';
  if (kind === 'relation-many')
    return Array.isArray(value) && value.length > 0 ? String(value.length) : '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : String(value.length);
  if ((kind === 'date' || kind === 'datetime') && typeof value === 'string') {
    const options = kind === 'datetime' ? DATE_TIME_OPTIONS : undefined;
    return formatCalendarDate(value, options) ?? '—';
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : `${String(Math.round(value * 100))}%`;
  if (typeof value === 'string') return value.replaceAll('_', ' ');
  return '—';
}

/** Return a stable serialized key for one one- or two-level server group path. */
export function workViewGroupPathKey(path: readonly string[]): string {
  return path.map((part) => encodeURIComponent(part)).join('/');
}
