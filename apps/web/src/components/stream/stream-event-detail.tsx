'use client';

/**
 * `stream` — the kind-specific detail slot under a row's primary line.
 *
 * @remarks
 * Preserves source richness without per-source layouts by reading the typed
 * {@link EventDetail} union (not a contract-free blob): a from→to pill for Docket state
 * changes, a state/priority line for Linear issues, a number/merged/draft line for GitHub
 * PRs and a summary/link for the `generic` arm.
 * Falls back to the event's `summary` when there's no typed detail, and renders nothing
 * when there's nothing extra — so terse events stay compact.
 */
import type { EventDetail } from '@docket/types';
import type { JSX } from 'react';

import type { StreamEventRow } from './stream-meta';

/** A small inline state pill (e.g. a workflow state or "from → to" leg). */
function Pill({ label }: { readonly label: string }): JSX.Element {
  return (
    <span className="bg-surface-container text-on-surface-variant w-fit rounded-md px-2 py-0.5 text-xs">
      {label}
    </span>
  );
}

/** A quoted, line-clamped snippet (messages, summaries). */
function Quote({ text }: { readonly text: string }): JSX.Element {
  return (
    <p className="border-outline-variant text-on-surface/80 line-clamp-2 border-l-2 pl-2.5 text-sm">
      {text}
    </p>
  );
}

/** Render the typed detail union, or `null` when an arm has nothing to show. */
function renderDetail(detail: EventDetail): JSX.Element | null {
  switch (detail.schema) {
    case 'docket.state_change':
      return (
        <div className="flex items-center gap-1.5">
          {detail.fromState ? (
            <>
              <Pill label={detail.fromState} />
              <span aria-hidden="true" className="text-on-surface-variant/50 text-xs">
                →
              </span>
            </>
          ) : null}
          <Pill label={detail.toState} />
        </div>
      );
    case 'linear.issue': {
      const label = [detail.stateName, detail.priority != null ? `P${detail.priority}` : null]
        .filter((p): p is string => p != null)
        .join(' · ');
      return label ? <Pill label={label} /> : null;
    }
    case 'github.pull_request': {
      const status = detail.merged ? 'merged' : detail.draft ? 'draft' : 'open';
      return <Pill label={`#${detail.number} · ${status}`} />;
    }
    case 'generic':
      return detail.summary ? <Quote text={detail.summary} /> : null;
    default:
      return null;
  }
}

/** Props for {@link StreamEventDetail}. */
export interface StreamEventDetailProps {
  /** The row whose detail to render. */
  readonly row: StreamEventRow;
}

/** The kind-specific detail block, or `null` when there's nothing extra to show. */
export function StreamEventDetail({ row }: StreamEventDetailProps): JSX.Element | null {
  const typed = row.detail ? renderDetail(row.detail) : null;
  if (typed) return <div className="mt-1.5 flex flex-col gap-1.5">{typed}</div>;
  if (!row.summary) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <Quote text={row.summary} />
    </div>
  );
}
