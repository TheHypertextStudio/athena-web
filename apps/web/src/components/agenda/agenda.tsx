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

import AgendaCanvas from './agenda-canvas';
import AgendaHeader from './agenda-header';
import { AgendaProvider } from './agenda-context';

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
        <AgendaViewport>
          <AgendaCanvas />
        </AgendaViewport>
      </div>
    </AgendaProvider>
  );
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
