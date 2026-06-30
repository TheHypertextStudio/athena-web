'use client';

/**
 * `stream` — the actor avatar with a small kind-badge overlay.
 *
 * @remarks
 * Carries "who + what kind" at a glance: a deterministic-color initials disc (or photo when the
 * provider exposes one) with a tiny corner glyph for the event kind. One avatar shape across all
 * sources keeps the feed homogeneous; the kind badge does the per-event differentiation.
 */
import { getOrgAccent } from '@docket/ui/lib/org-accent';
import {
  ArrowRight,
  AtSign,
  Calendar,
  CheckCircle2,
  Circle,
  Heart,
  type LucideIcon,
  MessageSquare,
  Sparkles,
} from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { type KindGlyph } from './stream-meta';

/** Resolve a kind-glyph icon key to its component. */
const GLYPH_ICON: Record<string, LucideIcon> = {
  mention: AtSign,
  assignment: ArrowRight,
  completed: CheckCircle2,
  comment: MessageSquare,
  status: Sparkles,
  reaction: Heart,
  calendar: Calendar,
  created: Circle,
};

/** Two uppercase initials from a display name (falls back to a dot). */
function initials(name: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

/** Props for {@link ActorAvatar}. */
export interface ActorAvatarProps {
  /** The actor's display name (drives initials + accent). */
  readonly name: string | null;
  /** The actor's avatar URL, when known (reserved; initials are shown for now). */
  readonly avatarUrl?: string | null;
  /** The event kind + tone (for the corner badge). */
  readonly glyph: KindGlyph;
  /** A stable seed for the accent color (e.g. the actor name or event id). */
  readonly seed: string;
}

/** The actor avatar with a corner kind-badge. */
export function ActorAvatar({ name, glyph, seed }: ActorAvatarProps): JSX.Element {
  const Icon = GLYPH_ICON[glyph.icon] ?? Circle;
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: getOrgAccent(seed) }}
      >
        {initials(name)}
      </span>
      <span
        aria-hidden="true"
        className="bg-surface absolute -right-1 -bottom-1 flex h-4.5 w-4.5 items-center justify-center rounded-full ring-2 ring-[var(--color-surface)]"
      >
        <Icon className={cn('h-3 w-3', glyph.tone)} />
      </span>
    </span>
  );
}
