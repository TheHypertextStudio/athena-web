'use client';

/**
 * `agenda/agenda` — the portable agenda surface.
 *
 * @remarks
 * A self-contained, reusable surface: give it an optional starting day (defaults to today) and it
 * navigates and renders the day's agenda. It carries no rail chrome of its own (no panel title, no
 * collapse) — the shell rail wraps it with that — so the same `<Agenda>` can be a rail today and a
 * full page later, unchanged. The day navigator + (later) view switcher are part of the agenda's
 * own header and slot into {@link AgendaProvider}'s context without new plumbing.
 */
import { type JSX, type ReactNode } from 'react';

import { Button } from '@docket/ui/primitives';

import AgendaCanvas from './agenda-canvas';
import AgendaHeader from './agenda-header';
import { AgendaProvider, useAgenda } from './agenda-context';

/** Props for {@link Agenda}. */
export interface AgendaProps {
  /** The day to start on (defaults to today). */
  initialDate?: string;
}

/** The portable agenda surface for a day (defaults to today). */
export default function Agenda({ initialDate }: AgendaProps): JSX.Element {
  return (
    <AgendaProvider initialDate={initialDate}>
      <div className="flex h-full min-h-0 flex-col" data-agenda-surface="">
        <div className="shrink-0 px-3 pt-3 pb-1">
          <AgendaHeader />
        </div>
        <AgendaStatusNotice />
        <AgendaViewport>
          <AgendaCanvas />
        </AgendaViewport>
      </div>
    </AgendaProvider>
  );
}

/** The loading or degraded disclosure, above the canvas rather than inside its scrollport. */
function AgendaStatusNotice(): JSX.Element | null {
  const { loading, error, retry, retrying } = useAgenda();
  if (loading) return <AgendaLoadingNotice />;
  if (error) return <AgendaDegradedNotice onRetry={retry} retrying={retrying} />;
  return null;
}

/** Props for {@link AgendaViewport}. */
interface AgendaViewportProps {
  /** The view canvas to render once loaded. */
  children: ReactNode;
}

/**
 * The body that always renders the agenda canvas once the initial read settles.
 *
 * @remarks
 * Server data enriches this ambient shell surface; it does not own the surface. A failed refresh
 * therefore leaves cached entries in place (or renders the normal empty state on first failure)
 * with a quiet status notice instead of replacing the agenda with raw server error copy.
 *
 * **Exactly one scrollport.** This wrapper used to be `overflow-auto` around a canvas sized
 * `height: 100%` that scrolls itself, so whenever a notice rendered above the canvas the wrapper
 * overflowed too and the rail grew a second scrollbar beside the first. The notice is now a sibling
 * of this element rather than a child, and the canvas is the only thing that scrolls.
 */
function AgendaViewport({ children }: AgendaViewportProps): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-hidden">{children}</div>;
}

/** A quiet disclosure that enrichment is loading while the usable calendar structure stays put. */
function AgendaLoadingNotice(): JSX.Element {
  // placeholder: the day's events and blocks, which arrive from the calendar read. Deliberately a
  // single line of copy rather than skeleton rows: the agenda's own structure (its hours, its
  // date, its column) is statically known and stays on screen, so only the enrichment is absent.
  return (
    <div
      role="status"
      className="bg-surface-container-low text-on-surface-variant text-caption mx-3 mb-2 shrink-0 rounded-lg px-3 py-2"
    >
      Loading calendar…
    </div>
  );
}

interface AgendaDegradedNoticeProps {
  readonly onRetry: () => void;
  readonly retrying: boolean;
}

/** A quiet, non-blocking disclosure with one explicit way to refresh the rendered agenda. */
function AgendaDegradedNotice({ onRetry, retrying }: AgendaDegradedNoticeProps): JSX.Element {
  return (
    <div
      role="status"
      className="bg-surface-container-low text-on-surface-variant text-caption mx-3 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2"
    >
      <span>Calendar updates are temporarily unavailable. Showing what we have.</span>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 [@media(pointer:coarse)]:h-10"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
