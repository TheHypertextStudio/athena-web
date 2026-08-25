/**
 * `settings` — Google Calendar's place in the Connections directory.
 *
 * @remarks
 * Calendar is not a generic provider card: its accounts and per-calendar visibility have a nested
 * surface of their own, so it renders as one row that leads there rather than connecting inline.
 *
 * It was a hand-rolled tonal box under a bare caption, which made it the one entry on Connections
 * that was neither a provider card nor a settings row. It is a settings row.
 */
import type { JSX } from 'react';

import { SettingRow } from './setting-row';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';

/** Props for {@link CalendarConnectionRow}. */
export interface CalendarConnectionRowProps {
  /** The calendar provider's display name. */
  name: string;
  /** One-line description of what connecting the calendar does. */
  effect: string;
  /** Route to the nested calendar configuration page. */
  href: string;
}

/**
 * The Google Calendar connection, as one row that opens its own page.
 *
 * @param props - The {@link CalendarConnectionRowProps}.
 * @returns the rendered group.
 */
export function CalendarConnectionRow({
  name,
  effect,
  href,
}: CalendarConnectionRowProps): JSX.Element {
  return (
    <SettingsGroup capability={SETTINGS_NODES.connectionsCalendar} body="rows">
      <SettingRow label={name} description={effect} href={href} />
    </SettingsGroup>
  );
}
