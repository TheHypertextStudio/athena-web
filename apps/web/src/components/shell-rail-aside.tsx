'use client';

/**
 * `shell-rail-aside` — the curated, Docket-native panels the shell's right rail offers.
 *
 * @remarks
 * Split out of `app-shell-frame.tsx` so the panel set is one small, testable decision rather than
 * part of the frame's wiring.
 */
import type { AppShellAside, RailPanel } from '@docket/ui/components';
import { Calendar, Timer } from '@docket/ui/icons';

import Agenda from '@/components/agenda/agenda';
import { AppShellAgendaSkeleton } from '@/components/app-shell-skeletons';
import { FocusPanel, focusRailStatus, type TimerStatus } from '@/components/time-tracking';

/** The route that is the Athena conversation at full width. */
const ATHENA_ROUTE = '/athena';

/**
 * Whether "open Athena" has no rail panel to land in on this route: settings and the calendar
 * render no rail, and `/athena` is the conversation itself, so each opens the page instead.
 *
 * @param pathname - The current route's path.
 * @param settingsSurface - Whether the route is a settings surface.
 * @param calendarSurface - Whether the route is the calendar.
 */
export function athenaRailUnavailable(
  pathname: string,
  settingsSurface: boolean,
  calendarSurface: boolean,
): boolean {
  return settingsSurface || calendarSurface || pathname === ATHENA_ROUTE;
}

/**
 * The curated, Docket-native rail panels for a non-calendar surface. Internal-only by design — the
 * Athena conversation, the Agenda, and Focus — never an integration add-on gallery.
 *
 * @remarks
 * The calendar does not use this rail. Its own timeline is the primary planning surface, and a
 * docked companion steals enough width to hide a normal seven-day week.
 *
 * Every panel here is a per-person read, so they are swapped for a placeholder on
 * `identityUnknown` alone. The workspace list is irrelevant to all of them.
 *
 * Athena leads the rail, ahead of Agenda and Focus: it is the companion, not one integration among
 * several. A fresh window opens on Athena when its status carries the `attention` tone — a proposal
 * or question is waiting — and opens on the Agenda otherwise. The shell only reads this default
 * once per mount, so the open panel never moves under the viewer.
 *
 * `/athena` passes no Athena panel: that page is the conversation at full width, and a second copy
 * in the rail would put every entry and a second composer on the same screen. Agenda and Focus
 * stay available beside it.
 *
 * @param identityUnknown - Whether the viewer is still unidentified; swaps panels for a placeholder.
 * @param timerStatus - The live tracker, which lends the Focus icon its status dot.
 * @param athenaPanel - The Athena rail panel.
 * @param pathname - The current route's path; `/athena` leaves the Athena panel out.
 * @returns The rail panel set and the panel shown until the viewer picks another.
 */
export function railAsideFor(
  identityUnknown: boolean,
  timerStatus: TimerStatus,
  athenaPanel: RailPanel,
  pathname: string,
): AppShellAside {
  const athena = pathname === ATHENA_ROUTE ? null : athenaPanel;
  const status = identityUnknown ? null : focusRailStatus(timerStatus);
  const focus: RailPanel = {
    id: 'focus',
    label: 'Focus',
    icon: <Timer aria-hidden="true" />,
    node: identityUnknown ? <AppShellAgendaSkeleton /> : <FocusPanel />,
    ...(status ? { status } : {}),
  };
  const agenda: RailPanel = {
    id: 'agenda',
    label: 'Agenda',
    icon: <Calendar aria-hidden="true" />,
    node: identityUnknown ? <AppShellAgendaSkeleton /> : <Agenda />,
  };
  if (!athena) return { panels: [agenda, focus], defaultPanelId: 'agenda' };
  return {
    panels: [athena, agenda, focus],
    defaultPanelId: athena.status?.tone === 'attention' ? 'athena' : 'agenda',
  };
}
