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

import { Skeleton, Stack } from '@docket/ui/primitives';

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
      <Stack gap={2} className="h-full min-h-0 p-3">
        <AgendaHeader />
        <AgendaViewport>
          <AgendaCanvas />
        </AgendaViewport>
      </Stack>
    </AgendaProvider>
  );
}

/** Props for {@link AgendaViewport}. */
interface AgendaViewportProps {
  /** The view canvas to render once loaded. */
  children: ReactNode;
}

/**
 * The scrolling body that always renders the agenda canvas once the initial read settles.
 *
 * @remarks
 * Server data enriches this ambient shell surface; it does not own the surface. A failed refresh
 * therefore leaves cached entries in place (or renders the normal empty state on first failure)
 * with a quiet status notice instead of replacing the agenda with raw server error copy.
 */
function AgendaViewport({ children }: AgendaViewportProps): JSX.Element {
  const { loading, error } = useAgenda();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {loading ? (
        <AgendaSkeleton />
      ) : (
        <>
          {error ? <AgendaDegradedNotice /> : null}
          {children}
        </>
      )}
    </div>
  );
}

/** Loading placeholder shaped like the day grid. */
function AgendaSkeleton(): JSX.Element {
  return <Skeleton className="h-[28rem] w-full rounded-xl" />;
}

/** A quiet, non-blocking disclosure that the rendered agenda could not refresh. */
function AgendaDegradedNotice(): JSX.Element {
  return (
    <div
      role="status"
      className="border-border bg-muted/40 text-muted-foreground text-caption mb-2 rounded-lg border px-3 py-2"
    >
      Calendar updates are temporarily unavailable. Showing what we have.
    </div>
  );
}
