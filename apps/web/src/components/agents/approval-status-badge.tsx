'use client';

/**
 * The single source of truth for an action's approval-state marker — shared by both the
 * activity stream ({@link import('./activity-item').ActivityItem}) and the changes receipt
 * ({@link import('./session-sidebar').SessionSidebar}) so the same gated action reads with an
 * identical label, tone, and glyph in both places.
 *
 * @remarks
 * Tone follows the session lifecycle vocabulary: `proposed` borrows the `primary` accent (it
 * is the one state still needing a human), settled-positive states use `state-completed`, and
 * `rejected` uses `destructive`. The only thing that varies between the two call sites is
 * density, expressed via the {@link ApprovalStatusBadgeProps.size | size} prop.
 */
import type { SessionActivityOut } from '@docket/types';
import { CheckCircle2, Sparkles, XCircle } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The token-driven treatment for a resolved (or proposed) approval state. */
interface ApprovalTreatment {
  /** Short label shown in the badge. */
  readonly label: string;
  /** Leading glyph component. */
  readonly Glyph: React.ComponentType<{ className?: string }>;
  /** Token-driven border + text classes. */
  readonly tone: string;
}

/** Per-status treatment for every gated-action approval state. */
const APPROVAL_TREATMENT: Record<
  Exclude<NonNullable<SessionActivityOut['approvalStatus']>, never>,
  ApprovalTreatment
> = {
  proposed: {
    label: 'Proposed',
    Glyph: Sparkles,
    tone: 'border-primary/40 text-primary',
  },
  approved: {
    label: 'Approved',
    Glyph: CheckCircle2,
    tone: 'text-state-completed border-state-completed/40',
  },
  applied: {
    label: 'Applied',
    Glyph: CheckCircle2,
    tone: 'text-state-completed border-state-completed/40',
  },
  rejected: {
    label: 'Rejected',
    Glyph: XCircle,
    tone: 'text-destructive border-destructive/40',
  },
};

/** Props for {@link ApprovalStatusBadge}. */
export interface ApprovalStatusBadgeProps {
  /** The approval state to render; renders nothing when `null`/`undefined`. */
  status: SessionActivityOut['approvalStatus'] | null;
  /**
   * Density of the marker.
   *
   * - `default` — the stream marker (h-3/w-3 glyph, default badge text).
   * - `compact` — the receipt marker (h-2.5/w-2.5 glyph, smaller text).
   */
  size?: 'default' | 'compact';
}

/**
 * A compact, token-colored approval-state marker for a gated `action` activity.
 *
 * @example
 * ```tsx
 * <ApprovalStatusBadge status="proposed" size="compact" />
 * ```
 */
export function ApprovalStatusBadge({
  status,
  size = 'default',
}: ApprovalStatusBadgeProps): JSX.Element | null {
  if (!status) return null;
  const { label, Glyph, tone } = APPROVAL_TREATMENT[status];
  const compact = size === 'compact';

  return (
    <Badge variant="outline" className={cn('shrink-0 gap-1', tone, compact && 'text-[0.625rem]')}>
      <Glyph className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> {label}
    </Badge>
  );
}
