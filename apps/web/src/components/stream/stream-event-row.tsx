'use client';

/**
 * `stream` — one rich row in the unified feed (generalized from `inbox/activity-row.tsx`).
 *
 * @remarks
 * Heterogeneous events, homogeneous layout: actor avatar + kind badge, a plain-English line, a
 * kind-specific detail slot, and a meta line (source badge + workspace chip in cross-org scope +
 * actor + relative time). The body is a button that opens the detail drawer; the hover action
 * cluster is a sibling (not nested) so there's no interactive-in-interactive.
 */
import { OrgChip } from '@/components/org-chip';
import type { JSX } from 'react';

import { relativeTime } from '../agents/format-time';
import { ActorAvatar } from './actor-avatar';
import { ProviderBadge } from './provider-badge';
import { StreamEventActions, type StreamRowActions } from './stream-event-actions';
import { StreamEventDetail } from './stream-event-detail';
import { kindGlyph, relevanceLabel, streamDescription, type StreamEventRow } from './stream-meta';

/** Props for {@link StreamRow}. */
export interface StreamRowProps {
  readonly row: StreamEventRow;
  /** `me` shows the workspace chip; `org` omits it. */
  readonly scope: 'me' | 'org';
  /** The originating org's display name (cross-org scope). */
  readonly orgName?: string;
  /** Row action callbacks. */
  readonly actions: StreamRowActions;
  /** Whether a mutation for this row is in flight. */
  readonly pending?: boolean;
  /** Open the detail drawer for this row. */
  readonly onSelect?: (row: StreamEventRow) => void;
}

/** A single rich stream row. */
export function StreamRow({
  row,
  scope,
  orgName,
  actions,
  pending,
  onSelect,
}: StreamRowProps): JSX.Element {
  const glyph = kindGlyph(row.kind);
  const relevance = relevanceLabel(row.relevance);
  return (
    <div className="group hover:bg-surface-container/40 relative flex items-start gap-3 rounded-lg px-3 py-3">
      <ActorAvatar
        name={row.actorName}
        avatarUrl={row.actorAvatarUrl}
        glyph={glyph}
        seed={row.actorName ?? row.id}
      />
      <button type="button" onClick={() => onSelect?.(row)} className="min-w-0 flex-1 text-left">
        <p className="text-on-surface/90 text-body leading-snug">{streamDescription(row)}</p>
        <StreamEventDetail row={row} />
        <div className="text-on-surface-variant mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {relevance ? (
            <span className="bg-primary-container/50 text-on-primary-container inline-flex items-center rounded-md px-1.5 py-0.5 font-medium">
              {relevance}
            </span>
          ) : null}
          <ProviderBadge system={row.system} />
          {scope === 'me' ? (
            <OrgChip orgId={row.organizationId} name={orgName ?? 'Workspace'} />
          ) : null}
          {row.actorName ? <span className="truncate">{row.actorName}</span> : null}
          <span aria-hidden="true" className="text-on-surface-variant/50">
            ·
          </span>
          <span>{relativeTime(row.occurredAt)}</span>
        </div>
      </button>
      <div className="absolute top-2.5 right-2 hidden group-focus-within:flex group-hover:flex">
        <StreamEventActions row={row} actions={actions} pending={pending} />
      </div>
    </div>
  );
}
