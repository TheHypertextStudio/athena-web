'use client';

/**
 * `stream` — the expanded-event right drawer.
 *
 * @remarks
 * Opening a row slides this drawer over a dimmed scrim: full event detail (actor, title, body,
 * timestamp) plus the action cluster. The Ask-Athena *drafted-plan approval* panel is added in
 * milestone D (it wires to the agent-session approval endpoints); the "Ask Athena" affordance is
 * already present here via the shared action cluster.
 */
import { X } from '@docket/ui/icons';
import type { JSX } from 'react';

import { ActorAvatar } from './actor-avatar';
import { AthenaPlan } from './athena-plan';
import { ProviderBadge } from './provider-badge';
import { StreamEventActions, type StreamRowActions } from './stream-event-actions';
import { kindGlyph, streamDescription, type StreamEventRow } from './stream-meta';

/** Build the agent brief from an event for the drafted-plan panel. */
function planPrompt(row: StreamEventRow): string {
  const parts = [streamDescription(row)];
  if (row.summary) parts.push(row.summary);
  if (row.permalink) parts.push(`Link: ${row.permalink}`);
  return parts.join('. ');
}

/** Props for {@link EventDrawer}. */
export interface EventDrawerProps {
  /** The selected row, or `null` to close. */
  readonly row: StreamEventRow | null;
  /** Close the drawer. */
  readonly onClose: () => void;
  /** Row action callbacks. */
  readonly actions: StreamRowActions;
  /** Whether a mutation for this row is in flight. */
  readonly pending?: boolean;
}

/** The expanded-event drawer (renders nothing when no row is selected). */
export function EventDrawer({
  row,
  onClose,
  actions,
  pending,
}: EventDrawerProps): JSX.Element | null {
  if (!row) return null;
  const glyph = kindGlyph(row.kind);
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/25"
        onClick={onClose}
      />
      <aside className="bg-surface border-outline-variant absolute top-0 right-0 flex h-full w-[420px] max-w-[92vw] flex-col border-l shadow-xl">
        <header className="border-outline-variant flex items-center gap-2 border-b px-4 py-3">
          <ProviderBadge system={row.system} />
          <span className="text-on-surface-variant text-xs capitalize">
            {row.kind.replace(/_/g, ' ')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-on-surface-variant hover:bg-surface-container ml-auto flex h-7 w-7 items-center justify-center rounded-md"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          <div className="flex items-start gap-3">
            <ActorAvatar
              name={row.actorName}
              avatarUrl={row.actorAvatarUrl}
              glyph={glyph}
              seed={row.actorName ?? row.id}
            />
            <div className="min-w-0">
              <p className="text-on-surface leading-snug font-medium">{streamDescription(row)}</p>
              <p className="text-on-surface-variant mt-0.5 text-xs">
                {new Date(row.occurredAt).toLocaleString()}
              </p>
            </div>
          </div>

          {row.entityTitle ? (
            <p className="text-on-surface mt-4 text-base font-semibold">{row.entityTitle}</p>
          ) : null}
          {row.summary ? (
            <p className="text-on-surface/80 bg-surface-container mt-3 rounded-lg p-3 text-sm whitespace-pre-wrap">
              {row.summary}
            </p>
          ) : null}

          <div className="border-outline-variant mt-4 border-t pt-4">
            <AthenaPlan orgId={row.organizationId} prompt={planPrompt(row)} />
          </div>
        </div>

        <footer className="border-outline-variant border-t p-3">
          <StreamEventActions row={row} actions={actions} pending={pending} />
        </footer>
      </aside>
    </div>
  );
}
