'use client';

/**
 * `components/plan-canvas/plan-status` — the small vocabulary every plan node shares.
 *
 * @remarks
 * A draft node borrows the proposal system's ghost grammar: a dashed outline at reduced weight on
 * a card, a dashed glyph, and a `draft` chip. A confirmed node is the ordinary tonal card with a
 * filled check and a `created` chip. One chip component carries both states so the three
 * renderers and the inspector cannot drift into three readings of "not real yet". A row inside a
 * container never draws the dashed outline: at that size the glyph and the chip are enough, and
 * a dashed border on every row turns a container into a field of stitching.
 */
import type { PlanNodeStatus } from '@docket/work/plan-draft-contract';
import { CheckCircle2, CircleDashed } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge } from '@docket/ui/primitives';
import { Handle, type HandleType, type Position } from '@xyflow/react';
import type { CSSProperties, JSX, ReactNode } from 'react';

/** The view-transition name a plan node carries so confirmation morphs it in place. */
export function planNodeTransitionName(ref: string): string {
  return `plan-node-${ref.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** The status glyph: dashed while a draft, a filled check once created. */
export function PlanStatusGlyph({
  status,
  className,
}: {
  readonly status: PlanNodeStatus;
  readonly className?: string;
}): JSX.Element {
  const Glyph = status === 'draft' ? CircleDashed : CheckCircle2;
  return (
    <Glyph
      role="img"
      aria-label={status === 'draft' ? 'Draft' : 'Created'}
      data-plan-status={status}
      className={cn(
        'size-4 shrink-0',
        status === 'draft' ? 'text-primary/70' : 'text-state-completed',
        className,
      )}
    />
  );
}

/** The state chip a node and the inspector share: `draft` in outline, `created` with a check. */
export function PlanStateChip({
  status,
  className,
}: {
  readonly status: PlanNodeStatus;
  readonly className?: string;
}): JSX.Element {
  if (status === 'draft') {
    return (
      <Badge
        variant="outline"
        data-plan-state="draft"
        className={cn('border-primary/40 text-primary', className)}
      >
        draft
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      data-plan-state="confirmed"
      className={cn('text-state-completed gap-0.5', className)}
    >
      <CheckCircle2 aria-hidden="true" className="size-3" />
      created
    </Badge>
  );
}

/** Text that sweeps with a highlight when the latest revision changed its field. */
export function PlanField({
  changed,
  className,
  children,
}: {
  readonly changed: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(changed && 'plan-field-changed', className)}
      data-changed={changed || undefined}
    >
      {children}
    </span>
  );
}

/** How a plan node is drawn: a standalone card, or a row inside a container. */
export type PlanCardShape = 'card' | 'row';

/**
 * The classes a plan card wears for its status and its arrival.
 *
 * @param shape - A `card` draws the draft's dashed outline; a `row` leaves the glyph and chip to
 * carry the state.
 */
export function planCardClasses(
  status: PlanNodeStatus,
  entered: boolean,
  selected: boolean,
  shape: PlanCardShape = 'card',
): string {
  return cn(
    'transition-colors',
    status === 'draft' && shape === 'card' && 'border-primary/40 border border-dashed',
    entered && 'plan-node-enter',
    selected && 'ring-primary ring-2',
  );
}

/** The size utility a handle takes. */
export type PlanHandleSize = '!size-1.5' | '!size-2';

/**
 * Connection handles rest invisible and surface when their node is hovered, focused, or selected,
 * so a board of rows reads as rows rather than as a field of dots. Pass `size` as the Tailwind
 * size utility the handle should take.
 */
export function planHandleClasses(size: PlanHandleSize): string {
  return cn(
    '!bg-outline opacity-0 transition-opacity',
    'group-hover:opacity-100 group-focus-within:opacity-100 [.react-flow__node.selected_&]:opacity-100',
    size,
  );
}

/** Props for {@link PlanDependencyHandle}. */
export interface PlanDependencyHandleProps {
  readonly id: 'dep-in' | 'dep-out';
  readonly type: HandleType;
  readonly position: Position;
  readonly size: PlanHandleSize;
  readonly style?: CSSProperties | undefined;
}

/**
 * A handle a dependency is drawn from or to. It names itself, so a pointer resting on it learns
 * what dragging does, and it takes the accent under the pointer so the target is unmistakable.
 */
export function PlanDependencyHandle({
  id,
  type,
  position,
  size,
  style,
}: PlanDependencyHandleProps): JSX.Element {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      style={style}
      title="Drag to add a dependency"
      aria-label="Drag to add a dependency"
      className={cn(planHandleClasses(size), 'hover:!bg-primary z-10 transition-colors')}
    />
  );
}
