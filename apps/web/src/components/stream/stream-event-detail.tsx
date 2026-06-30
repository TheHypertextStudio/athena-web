'use client';

/**
 * `stream` — the kind-specific detail slot under a row's primary line.
 *
 * @remarks
 * Preserves source richness without per-source layouts: a status pill for status/completion
 * events (when the payload carries one) and a quoted snippet for messages/comments/mentions and
 * any event with a summary. Renders nothing when there's no extra detail, so terse events stay
 * compact.
 */
import type { JSX } from 'react';

import type { StreamEventRow } from './stream-meta';

/** Read a status/state string off the payload, when present. */
function statusValue(row: StreamEventRow): string | null {
  const candidate = row.payload['status'] ?? row.payload['state'];
  return typeof candidate === 'string' ? candidate : null;
}

/** Props for {@link StreamEventDetail}. */
export interface StreamEventDetailProps {
  /** The row whose detail to render. */
  readonly row: StreamEventRow;
}

/** The kind-specific detail block, or `null` when there's nothing extra to show. */
export function StreamEventDetail({ row }: StreamEventDetailProps): JSX.Element | null {
  const status =
    row.kind === 'status_change' || row.kind === 'completed' ? statusValue(row) : null;
  if (!row.summary && !status) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {status ? (
        <span className="bg-surface-container text-on-surface-variant w-fit rounded-md px-2 py-0.5 text-xs">
          {status}
        </span>
      ) : null}
      {row.summary ? (
        <p className="border-outline-variant text-on-surface/80 line-clamp-2 border-l-2 pl-2.5 text-sm">
          {row.summary}
        </p>
      ) : null}
    </div>
  );
}
