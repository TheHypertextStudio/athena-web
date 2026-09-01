'use client';

/**
 * The Cycles roster adapter for the shared responsive table.
 *
 * @remarks
 * EntityTable owns sizing, headers, scrolling, visibility, and row chrome. This module owns the
 * Cycle-specific identity, rename control, status, progress, points, link, and object binding.
 */
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { type CycleOut, type CycleStats } from '@docket/work/cycle-contract';
import {
  type Column,
  EntityTable,
  type EntityTableProps,
  type EntityTableRowLinkProps,
} from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import { createContext, type JSX, useContext } from 'react';

import Link from '@/components/docket-link';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { WorkStatusBadge } from '@/components/entity-display/work-status';
import { ObjectSurface } from '@/components/objects/object-surface';

import { CYCLE_STATUS } from './cycle-status';
import { formatWindow } from './format-window';

/** The Cycle-specific data and interactions required by one shared table row. */
export interface CycleRowProps {
  /** The cycle to summarize. */
  cycle: CycleOut;
  /** Decorative identity, composed through the bulk display read. */
  display?: EntityDisplayOut | undefined;
  /** The cycle's rolled-up stats, or `null` while they load or after a failed read. */
  stats: CycleStats | null;
  /** The owning team's display name. */
  teamName: string;
  /** The vocabulary-resolved singular cycle noun. */
  cycleNoun: string;
  /** Href to the cycle's detail screen. */
  href: string;
  /** Warm the cycle-detail cache on hover or focus. */
  onPrefetch?: (() => void) | undefined;
  /** Whether the viewer may rename this cycle in place. */
  canRename?: boolean | undefined;
  /** Persist a renamed cycle name. */
  onRename?: ((cycleId: string, name: string) => void) | undefined;
  /** Open the cycle from a non-link part of the row. */
  onOpen?: (() => void) | undefined;
}

/** Props for {@link CycleRows}. */
export type CycleRowsProps = NonNullable<
  EntityTableProps<CycleRowProps>['containerInteraction']
> & {
  /** The cycle rows to render, in order. */
  rows: readonly CycleRowProps[];
  /** Accessible label for the roster grid. */
  ariaLabel: string;
  className?: string | undefined;
};

/** Return the visible subtitle without repeating an unnamed Cycle's window. */
function cycleSubtitle({ cycle, teamName }: CycleRowProps): string {
  return cycle.name ? `${formatWindow(cycle.startsAt, cycle.endsAt)} · ${teamName}` : teamName;
}

/** Render the Cycle identity and optional inline rename control. */
function CycleIdentity({ row }: { readonly row: CycleRowProps }): JSX.Element {
  const { cycle, display, cycleNoun, canRename, onRename, onOpen } = row;
  const identity = display ?? defaultEntityDisplay('cycle', cycle.id);
  return (
    <span className="flex min-w-0 items-center gap-3 py-1">
      <EntityIconGlyph
        iconKey={identity.iconKey}
        colorKey={identity.colorKey}
        customColor={identity.customColor}
        size={32}
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {canRename && onRename ? (
            <EditableTitle
              value={cycle.name ?? ''}
              onSave={(name) => {
                onRename(cycle.id, name);
              }}
              canEdit
              activate="doubleClick"
              {...(onOpen ? { onActivate: onOpen } : {})}
              ariaLabel={`${cycleNoun} name`}
              placeholder={cycle.displayName}
              className="text-on-surface text-body-medium line-clamp-1 min-w-0 font-medium"
            />
          ) : (
            <span className="text-on-surface text-body-medium line-clamp-1 font-medium">
              {cycle.displayName}
            </span>
          )}
        </span>
        <span className="text-on-surface-variant text-body-small mt-0.5 block truncate">
          {cycleSubtitle(row)}
        </span>
      </span>
    </span>
  );
}

/** Render one Cycle's completed versus committed task progress. */
function CycleProgress({ cycle, stats }: CycleRowProps): JSX.Element {
  if (!stats) {
    return (
      <span className="flex items-center gap-2">
        <Skeleton className="h-1.5 w-14 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </span>
    );
  }
  const taskPct = stats.committed > 0 ? Math.round((stats.completed / stats.committed) * 100) : 0;
  return (
    <span
      className="flex items-center gap-2"
      aria-label={`${String(stats.completed)} of ${String(stats.committed)} tasks completed in ${cycle.displayName}`}
    >
      <span className="bg-surface-container-highest h-1.5 w-14 overflow-hidden rounded-full">
        <span className="bg-primary block h-full rounded-full" style={{ width: `${taskPct}%` }} />
      </span>
      <span className="text-body-medium tabular-nums">
        <span className="text-on-surface font-medium">{stats.completed}</span>
        <span className="text-on-surface-variant">/{stats.committed}</span>
      </span>
    </span>
  );
}

/** Render one Cycle's capacity or carryover summary. */
function CyclePoints({ cycle, stats }: CycleRowProps): JSX.Element {
  if (!stats) return <Skeleton className="h-3 w-12" />;
  if (stats.carryover > 0 && cycle.status !== 'completed') {
    return <span className="text-state-started font-medium">{stats.carryover} open</span>;
  }
  return (
    <span>
      {stats.completedCapacity}/{stats.capacity} pts
    </span>
  );
}

/** The one responsive column sequence shared by Cycle headers and rows. */
const CYCLE_COLUMNS: readonly Column<CycleRowProps>[] = [
  {
    key: 'cycle',
    header: 'Cycle',
    flex: true,
    minWidth: '22rem',
    render: (row) => <CycleIdentity row={row} />,
  },
  {
    key: 'status',
    header: 'Status',
    width: '7rem',
    priority: 1,
    render: ({ cycle }) => {
      const status = CYCLE_STATUS[cycle.status];
      return <WorkStatusBadge name={status.name} category={status.category} />;
    },
  },
  {
    key: 'progress',
    header: 'Progress',
    width: '10rem',
    priority: 2,
    render: (row) => <CycleProgress {...row} />,
  },
  {
    key: 'points',
    header: 'Points',
    width: '8rem',
    priority: 3,
    render: (row) => <CyclePoints {...row} />,
  },
];

const CycleRowContext = createContext<CycleRowProps | null>(null);

/** Remove explicit undefined values before forwarding the table's exact-optional link props. */
function definedRowLinkProps<T extends object>(
  value: T,
): {
  [K in keyof T]: Exclude<T[K], undefined>;
} {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(value) as (keyof T)[]) {
    const fieldValue = value[key];
    if (fieldValue !== undefined) result[key] = fieldValue as Exclude<T[typeof key], undefined>;
  }
  return result;
}

/** Render EntityTable's row link through the existing Cycle object surface. */
function CycleRowLink(props: EntityTableRowLinkProps): JSX.Element {
  const row = useContext(CycleRowContext);
  if (row === null) throw new Error('CycleRowLink requires a Cycle row.');
  const object = {
    kind: 'cycle' as const,
    id: row.cycle.id,
    organizationId: row.cycle.organizationId,
    title: row.cycle.displayName,
  };
  return (
    <ObjectSurface object={object} surfaceId="cycles" href={props.href}>
      <Link
        {...definedRowLinkProps(props)}
        aria-label={`${row.cycle.displayName}, ${row.teamName}`}
      />
    </ObjectSurface>
  );
}

/** Render Cycle rows through the shared responsive table. */
export function CycleRows({ rows, ariaLabel, className, ...rest }: CycleRowsProps): JSX.Element {
  return (
    <EntityTable<CycleRowProps>
      aria-label={ariaLabel}
      columns={CYCLE_COLUMNS}
      rows={rows}
      getRowKey={({ cycle }) => cycle.id}
      tone="tonal"
      rowHeight={72}
      rowHref={({ href }) => href}
      renderRowLink={(props) => <CycleRowLink {...props} />}
      onRowPrefetch={(row) => {
        row.onPrefetch?.();
      }}
      renderRowInteraction={({ row, children }) => (
        <CycleRowContext.Provider value={row}>
          {children({
            selected: false,
            rowProps: { 'aria-selected': false, 'data-selected': false },
          })}
        </CycleRowContext.Provider>
      )}
      containerInteraction={rest}
      className={className}
    />
  );
}
