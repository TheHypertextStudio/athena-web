'use client';

import {
  defaultEntityDisplay,
  entityNavigationSnapshotFromWorkViewRow,
  type Health,
  type WorkViewActor,
} from '@docket/types';
import type { Column, ColumnPriority } from '@docket/ui/components';
import { Calendar } from '@docket/ui/icons';
import { STRETCHED_LINK } from '@docket/ui/lib/stretched-link';
import { cn } from '@docket/ui/lib/utils';
import { Checkbox } from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import type { JSX } from 'react';

import DocketLink from '@/components/docket-link';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { HealthLabel } from '@/components/entity-display/health';
import { ActorName } from '@/components/entity-display/roster-cells';
import type { WorkStatusDisplay } from '@/components/entity-display/work-status';
import { WorkStatusIcon } from '@/components/entity-display/work-status';
import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';
import { buildEntityHref } from '@/lib/authenticated-route';
import { seedNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';

import {
  INITIATIVE_DEPTH_PX,
  INITIATIVE_ELBOW_RADIUS_PX,
  INITIATIVE_LEADING_SLOT_PX,
  INITIATIVE_RAIL_STROKE_PX,
  INITIATIVE_SLOT_CENTER_PX,
  type InitiativeTreePosition,
} from './initiative-rails';
import type { ListMembership } from './work-list-groups';
import {
  formatWorkViewValue,
  type WorkViewRowFor,
  workViewRowTitle,
  workViewRowValue,
} from './renderer-types';
import type { WorkViewDefinitionFor, WorkViewDisplayFieldMetadata } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';

/** Density-specific roster heights shared by the table estimate and rail geometry. */
export const WORK_ROSTER_ROW_HEIGHT = {
  compact: 44,
  comfortable: 56,
} as const;

/** Responsive minimum for the one shared identity header and cell. */
export const WORK_ROSTER_IDENTITY_MIN_WIDTH = 'min(22rem, calc(100cqw - 1.5rem))';

/** Numeric widths for every work-view metadata field with a non-default contract. */
export const WORK_ROSTER_FIELD_WIDTH_PX: Readonly<Record<string, number>> = {
  status: 128,
  priority: 80,
  health: 96,
  assignee: 176,
  delegate: 176,
  lead: 176,
  owner: 176,
  leadTeam: 128,
  labels: 128,
  startDate: 112,
  dueDate: 112,
  targetDate: 112,
  targetTimeframe: 128,
  updateCadence: 128,
  latestUpdate: 176,
  parent: 128,
  organization: 128,
  progress: 112,
  estimate: 96,
  estimateMinutes: 96,
  taskCount: 96,
  projectCount: 96,
  dependencyCount: 112,
};

/** Sentinel that keeps the row as a div while the identity renderer owns its nested real link. */
export const WORK_ROSTER_INLINE_LINK_COLUMN_KEY = '__work-roster-inline-link';

const TARGET_LABEL = {
  task: 'Task',
  project: 'Project',
  program: 'Program',
  initiative: 'Initiative',
} as const;

const IDENTITY_FLOOR_PX = 352;
const TABLE_INLINE_INSET_PX = 24;
const COLUMN_GAP_PX = 8;
const DEFAULT_FIELD_WIDTH_PX = 128;

const PRIORITY_BREAKPOINTS: readonly {
  readonly maximum: number;
  readonly priority: Exclude<ColumnPriority, 'always'>;
}[] = [
  { maximum: 448, priority: 1 },
  { maximum: 512, priority: 2 },
  { maximum: 576, priority: 3 },
  { maximum: 672, priority: 4 },
  { maximum: 768, priority: 5 },
  { maximum: 896, priority: 6 },
  { maximum: 1024, priority: 7 },
  { maximum: 1152, priority: 8 },
  { maximum: 1280, priority: 9 },
];

/**
 * Return the identity width that the CSS clamp yields for one container width.
 *
 * @param containerWidthPx - Available inline space including the table inset.
 * @returns the clamped identity width in pixels.
 */
export function workRosterIdentityWidthAt(containerWidthPx: number): number {
  return Math.min(IDENTITY_FLOOR_PX, Math.max(0, containerWidthPx - TABLE_INLINE_INSET_PX));
}

/** Resolve the first shared container tier that satisfies a cumulative pixel requirement. */
function priorityForRequirement(requiredWidthPx: number): Exclude<ColumnPriority, 'always'> {
  return PRIORITY_BREAKPOINTS.find(({ maximum }) => requiredWidthPx <= maximum)?.priority ?? 9;
}

/** Resolve a projected actor relation without weakening the row type. */
function rowActor(row: WorkViewRowFor<ViewTarget>, field: string): WorkViewActor | null {
  if (row.target === 'task' && field === 'assignee') return row.assigneeActor;
  if (row.target === 'project' && field === 'lead') return row.leadActor;
  if (row.target === 'program' && field === 'owner') return row.ownerActor;
  if (row.target === 'initiative' && field === 'owner') return row.ownerActor;
  return null;
}

/** Resolve the optional secondary line for one work row. */
function rowSummary(row: WorkViewRowFor<ViewTarget>): string | null {
  switch (row.target) {
    case 'task':
      return row.description;
    case 'project':
    case 'program':
    case 'initiative':
      return row.summary;
  }
}

/** Render one entity glyph inside the fixed leading identity slot. */
function IdentityGlyph({ row }: { readonly row: WorkViewRowFor<ViewTarget> }): JSX.Element {
  const display = row.display ?? defaultEntityDisplay(row.target, row.id);
  return (
    <EntityIconGlyph
      iconKey={display.iconKey}
      colorKey={display.colorKey}
      customColor={display.customColor}
      size={INITIATIVE_LEADING_SLOT_PX}
    />
  );
}

/** Render the fixed leading slot as either an entity glyph or its selection checkbox. */
function SelectionIdentity({
  row,
  writable,
  selected,
  selectionActive,
  onToggle,
}: {
  readonly row: WorkViewRowFor<ViewTarget>;
  readonly writable: boolean;
  readonly selected: boolean;
  readonly selectionActive: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  if (!writable) {
    return (
      <span
        data-work-roster-leading-slot
        className="relative z-10 flex size-8 shrink-0 items-center justify-center"
      >
        <IdentityGlyph row={row} />
      </span>
    );
  }
  return (
    <span
      data-work-roster-leading-slot
      className="relative z-10 flex size-8 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity',
          selected || selectionActive
            ? 'opacity-100'
            : 'opacity-0 group-focus-within/roster:opacity-100 group-hover/roster:opacity-100',
        )}
      >
        <Checkbox
          aria-label={`Select ${workViewRowTitle(row)}`}
          checked={selected}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onChange={onToggle}
        />
      </span>
      <span
        aria-hidden={selected || selectionActive}
        className={cn(
          'pointer-events-none transition-opacity',
          selected || selectionActive
            ? 'opacity-0'
            : 'opacity-100 group-focus-within/roster:opacity-0 group-hover/roster:opacity-0',
        )}
      >
        <IdentityGlyph row={row} />
      </span>
    </span>
  );
}

/** Draw decorative hierarchy rails with the elbow centered on the resolved row height. */
function HierarchyRails({
  position,
  rowHeight,
}: {
  readonly position: InitiativeTreePosition;
  readonly rowHeight: number;
}): JSX.Element | null {
  const { depth, ancestorRailContinues, hasChildren, isLastSibling } = position;
  if (depth === 1 && !hasChildren && !ancestorRailContinues.some(Boolean)) return null;
  const targetLeft = (depth - 1) * INITIATIVE_DEPTH_PX;
  const iconCenter = targetLeft + INITIATIVE_SLOT_CENTER_PX;
  const branchY = rowHeight / 2;
  const parentRailX = iconCenter - INITIATIVE_DEPTH_PX;
  const slotTop = (rowHeight - INITIATIVE_LEADING_SLOT_PX) / 2;
  const slotBottom = slotTop + INITIATIVE_LEADING_SLOT_PX;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="initiative-hierarchy-rail"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      height={rowHeight}
      width="100%"
    >
      <g
        className="stroke-outline-variant"
        fill="none"
        strokeWidth={INITIATIVE_RAIL_STROKE_PX}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ancestorRailContinues.map((continues, index) =>
          continues ? (
            <line
              key={index}
              data-ancestor-rail={index}
              x1={index * INITIATIVE_DEPTH_PX + INITIATIVE_SLOT_CENTER_PX}
              y1={0}
              x2={index * INITIATIVE_DEPTH_PX + INITIATIVE_SLOT_CENTER_PX}
              y2={rowHeight}
            />
          ) : null,
        )}
        {depth > 1 ? (
          <>
            <line
              x1={parentRailX}
              y1={0}
              x2={parentRailX}
              y2={isLastSibling ? branchY - INITIATIVE_ELBOW_RADIUS_PX : rowHeight}
            />
            <path
              d={`M ${String(parentRailX)} ${String(branchY - INITIATIVE_ELBOW_RADIUS_PX)} Q ${String(parentRailX)} ${String(branchY)} ${String(parentRailX + INITIATIVE_ELBOW_RADIUS_PX)} ${String(branchY)} H ${String(targetLeft)}`}
            />
          </>
        ) : null}
        {hasChildren ? (
          <line x1={iconCenter} y1={slotBottom} x2={iconCenter} y2={rowHeight} />
        ) : null}
      </g>
    </svg>
  );
}

/** Render the shared header content for the identity column. */
function IdentityHeader({ label }: { readonly label: string }): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        data-work-roster-leading-slot
        className="flex size-8 shrink-0 items-center justify-center"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Render one path membership through the shared identity contract. */
function IdentityCell<TTarget extends ViewTarget>({
  membership,
  writable,
  selected,
  selectionActive,
  onToggle,
  position,
  rowHeight,
}: {
  readonly membership: ListMembership<TTarget>;
  readonly writable: boolean;
  readonly selected: boolean;
  readonly selectionActive: boolean;
  readonly onToggle: () => void;
  readonly position: InitiativeTreePosition | undefined;
  readonly rowHeight: number;
}): JSX.Element {
  const row = membership.row as WorkViewRowFor<ViewTarget>;
  const summary = rowSummary(row);
  const navigationSnapshot = entityNavigationSnapshotFromWorkViewRow(row);
  return (
    <span className="relative flex w-full min-w-0 items-center gap-3">
      {position ? <HierarchyRails position={position} rowHeight={rowHeight} /> : null}
      <span
        className="relative flex min-w-0 items-center gap-3"
        style={position ? { paddingLeft: (position.depth - 1) * INITIATIVE_DEPTH_PX } : undefined}
      >
        <SelectionIdentity
          row={row}
          writable={writable}
          selected={selected}
          selectionActive={selectionActive}
          onToggle={onToggle}
        />
        <DocketLink
          href={buildEntityHref(navigationSnapshot)}
          className={cn(
            'focus-visible:ring-primary min-w-0 rounded-sm outline-none focus-visible:ring-2',
            STRETCHED_LINK,
          )}
          onClick={(event) => {
            seedNavigationSnapshot(navigationSnapshot);
            event.stopPropagation();
          }}
        >
          <span className="text-on-surface text-body-medium block truncate">
            {workViewRowTitle(row)}
          </span>
          {summary ? (
            <span className="text-on-surface-variant text-body-small block max-w-[52ch] truncate">
              {summary}
            </span>
          ) : null}
        </DocketLink>
      </span>
    </span>
  );
}

/** Render a status value when the current column owns status. */
function renderStatusPropertyValue({
  fieldKey,
  value,
  statusOf,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
  readonly statusOf: (key: string) => WorkStatusDisplay;
}): JSX.Element | null {
  if (fieldKey === 'status' && typeof value === 'string') {
    const status = statusOf(value);
    return (
      <span className="flex min-w-0 items-center gap-2">
        <WorkStatusIcon name={status.name} category={status.category} />
        <span className="truncate">{status.name}</span>
      </span>
    );
  }
  return null;
}

/** Render a priority value when the current column owns priority. */
function renderPriorityPropertyValue({
  fieldKey,
  value,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
}): JSX.Element | null {
  if (fieldKey !== 'priority' || typeof value !== 'string') return null;
  return <PriorityGlyph priority={value as 'urgent' | 'high' | 'medium' | 'low' | 'none'} />;
}

/** Render a health value when the current column owns health. */
function renderHealthPropertyValue({
  fieldKey,
  value,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
}): JSX.Element | null {
  if (fieldKey !== 'health' || (value !== null && typeof value !== 'string')) return null;
  return <HealthLabel health={value as Health | null} />;
}

/** Render one projected actor relation when it exists. */
function renderActorPropertyValue({
  actor,
}: {
  readonly actor: WorkViewActor | null;
}): JSX.Element | null {
  return actor === null ? null : <ActorName actor={actor} token="body-medium" tone="default" />;
}

/** Render a date or datetime with one stable calendar treatment. */
function renderDatePropertyValue({
  kind,
  value,
}: {
  readonly kind: string;
  readonly value: unknown;
}): JSX.Element | null {
  if (kind === 'date' || kind === 'datetime') {
    const formatted = typeof value === 'string' ? formatWorkViewValue(value, kind) : '—';
    return formatted === '—' ? (
      <span>—</span>
    ) : (
      <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
        <Calendar className="size-3.5" />
        {formatted}
      </span>
    );
  }
  return null;
}

/** Render the progress fraction as a bar plus an exact percentage. */
function renderProgressPropertyValue({
  fieldKey,
  value,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
}): JSX.Element | null {
  if (fieldKey !== 'progress' || typeof value !== 'number') return null;
  const percent = Math.round(value * 100);
  return (
    <span className="flex w-full items-center gap-2 tabular-nums">
      <span className="bg-surface-container-highest h-1.5 min-w-10 flex-1 overflow-hidden rounded-full">
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      {percent}%
    </span>
  );
}

/** Render collection values as a compact count. */
function renderCollectionPropertyValue(value: unknown): JSX.Element | null {
  return Array.isArray(value) ? <span className="tabular-nums">{value.length || '—'}</span> : null;
}

/** Render the remaining scalar and relation shapes. */
function renderScalarPropertyValue({
  kind,
  value,
}: {
  readonly kind: string;
  readonly value: unknown;
}): JSX.Element {
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : '—'}</span>;
  if (kind === 'relation-one' || kind === 'relation-many') return <span>—</span>;
  if (typeof value === 'object' && value !== null && 'label' in value) {
    return <span>{formatWorkViewValue(value, kind)}</span>;
  }
  if (typeof value === 'string' && value.length < 40) {
    return <span>{value.replaceAll('_', ' ')}</span>;
  }
  return <span>—</span>;
}

/** Render one target-discriminated property value. */
function PropertyValue<TTarget extends ViewTarget>({
  row,
  field,
  statusOf,
}: {
  readonly row: WorkViewRowFor<TTarget>;
  readonly field: WorkViewDisplayFieldMetadata<TTarget>;
  readonly statusOf: (key: string) => WorkStatusDisplay;
}): JSX.Element {
  const fieldKey = String(field.key);
  const displayRow = row as WorkViewRowFor<ViewTarget>;
  const value = workViewRowValue(displayRow, fieldKey);
  const actor = rowActor(displayRow, fieldKey);
  return (
    renderStatusPropertyValue({ fieldKey, value, statusOf }) ??
    renderPriorityPropertyValue({ fieldKey, value }) ??
    renderHealthPropertyValue({ fieldKey, value }) ??
    renderActorPropertyValue({ actor }) ??
    renderDatePropertyValue({ kind: field.kind, value }) ??
    renderProgressPropertyValue({ fieldKey, value }) ??
    renderCollectionPropertyValue(value) ??
    renderScalarPropertyValue({ kind: field.kind, value })
  );
}

/** Inputs for the target-bound work roster column builder. */
export interface BuildWorkListColumnsOptions<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly selectedIds: ReadonlySet<string>;
  /** Whether the roster has at least one writable selected row. */
  readonly selectionActive: boolean;
  /** Resolve selection and write authority for one full-path membership. */
  readonly isWritable: (membership: ListMembership<TTarget>) => boolean;
  readonly onToggleSelection: (rowId: string) => void;
  readonly statusOf: (key: string) => WorkStatusDisplay;
  readonly positions: ReadonlyMap<string, InitiativeTreePosition>;
  readonly rowHeight: number;
}

/**
 * Build one shared header-and-cell column array from numeric field widths.
 *
 * @param options - Target definition, selection state, status resolver, and Initiative geometry.
 * @returns the aligned EntityTable columns for path-scoped memberships.
 */
export function buildWorkListColumns<TTarget extends ViewTarget>({
  target,
  definition,
  selectedIds,
  selectionActive,
  isWritable,
  onToggleSelection,
  statusOf,
  positions,
  rowHeight,
}: BuildWorkListColumnsOptions<TTarget>): readonly Column<ListMembership<TTarget>>[] {
  const identityField = target === 'task' ? 'title' : 'name';
  const selectedProperties = workViewDisplayFieldCatalog(target).filter(
    (field) =>
      String(field.key) !== identityField && definition.presentation.properties.includes(field.key),
  );
  let cumulativeWidth = IDENTITY_FLOOR_PX + TABLE_INLINE_INSET_PX;
  const identity: Column<ListMembership<TTarget>> = {
    key: 'identity',
    header: <IdentityHeader label={TARGET_LABEL[target]} />,
    minWidth: WORK_ROSTER_IDENTITY_MIN_WIDTH,
    flex: true,
    priority: 'always',
    className: 'relative',
    render: (membership) => {
      const writable = isWritable(membership);
      return (
        <IdentityCell
          membership={membership}
          writable={writable}
          selected={writable && selectedIds.has(membership.row.id)}
          selectionActive={selectionActive}
          onToggle={() => {
            onToggleSelection(membership.row.id);
          }}
          position={positions.get(membership.key)}
          rowHeight={rowHeight}
        />
      );
    },
  };
  const metadata = selectedProperties.map<Column<ListMembership<TTarget>>>((field) => {
    const width = WORK_ROSTER_FIELD_WIDTH_PX[field.key] ?? DEFAULT_FIELD_WIDTH_PX;
    cumulativeWidth += COLUMN_GAP_PX + width;
    return {
      key: field.key,
      header: field.label,
      width: `${String(width)}px`,
      priority: priorityForRequirement(cumulativeWidth),
      className: 'text-on-surface-variant text-body-small px-2',
      render: (membership) => (
        <>
          <span className="sr-only">{field.label}: </span>
          <PropertyValue row={membership.row} field={field} statusOf={statusOf} />
        </>
      ),
    };
  });
  return [identity, ...metadata];
}
