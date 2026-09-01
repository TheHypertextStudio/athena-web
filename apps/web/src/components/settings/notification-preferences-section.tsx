'use client';

/**
 * `settings` — caller-owned notification preferences.
 *
 * @remarks
 * A compact preferences surface over the notification-domain DTOs: quiet hours first, then the
 * per-category channel matrix. The domain package owns defaults and locked-category policy; this
 * component only renders that policy and emits structured patches.
 */
import { defaultNotificationChannelPreference } from '@docket/notifications/preferences';
import { lockedPreference } from '@docket/notifications/policy';
import {
  type NotificationCategory as NotificationCategoryValue,
  type NotificationChannel,
  type NotificationPreferenceOut,
  type NotificationPreferencePatch,
  type NotificationQuietHours,
} from '@docket/notifications/schemas';
import { cn } from '@docket/ui';
import { WriteError } from './write-error';
import { Schedule } from '@docket/ui/icons';
import { Checkbox, Badge, Input } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';

/**
 * A selectable checkbox tile.
 *
 * @remarks
 * One tonal step above the group it sits in, rather than the outlined box it used to be: inside a
 * `card` group an outline would be the third line on the surface, and the tile is a thing you
 * press, so it takes a fill and a hover the way every other pressable does.
 */
const OPTION_TILE =
  'bg-surface-container hover:bg-surface-container-high flex items-center gap-3 rounded-md px-3 py-2 transition-colors ' +
  // The tile is the touch target for the checkbox inside it — a 16px mark is not one — so it
  // takes the same coarse floor every control on the surface does.
  'coarse:min-h-10 ' +
  // MD3's disabled opacity, applied to the whole tile so a switched-off group reads as one
  // inert block rather than live labels holding dead checkboxes.
  'has-disabled:pointer-events-none has-disabled:opacity-38';

const CHANNELS: readonly { key: NotificationChannel; label: string }[] = [
  { key: 'web', label: 'Web' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'push', label: 'Push' },
];

const CATEGORY_LABELS: Record<NotificationCategoryValue, string> = {
  security: 'Security',
  account: 'Account',
  service_announcement: 'Service announcements',
  workflow: 'Workflow',
  digest: 'Digests',
  billing: 'Billing',
  marketing: 'Marketing',
};

const CATEGORY_ORDER: readonly NotificationCategoryValue[] = [
  'security',
  'account',
  'service_announcement',
  'workflow',
  'billing',
  'digest',
  'marketing',
];

const DEFAULT_QUIET_HOURS: NotificationQuietHours = {
  enabled: false,
  start: '18:00',
  end: '08:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  allowUrgent: true,
};

const QUIET_DAYS: readonly { key: NotificationQuietHours['days'][number]; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

/** Props for {@link NotificationPreferencesSection}. */
export interface NotificationPreferencesSectionProps {
  /** The materialized caller preferences returned by the API. */
  readonly preferences: NotificationPreferenceOut;
  /** Whether a preference mutation is currently in flight. */
  readonly saving: boolean;
  /** Inline mutation/read error. */
  readonly error: string | null;
  /** Persist a structured notification preference patch. */
  readonly onPatch: (patch: NotificationPreferencePatch) => Promise<void> | void;
}

/** Caller-owned notification preference controls. */
export function NotificationPreferencesSection({
  preferences,
  saving,
  error,
  onPatch,
}: NotificationPreferencesSectionProps): JSX.Element {
  const [quietHours, setQuietHours] = useState<NotificationQuietHours>(
    preferences.quietHours ?? DEFAULT_QUIET_HOURS,
  );

  // The quiet-hours value we last mirrored in from the server; `null` until the first load seeds
  // it. Read at reconcile time via a ref so the effect below doesn't need `quietHours` itself as
  // a dependency (that would re-run on every local edit, not just server updates).
  const quietHoursRef = useRef(quietHours);
  quietHoursRef.current = quietHours;
  const syncedQuietHoursRef = useRef<NotificationQuietHours | null>(null);

  // Mirror the server's quiet hours into local state on the initial load and whenever the server
  // value genuinely changes — but only while the field still holds what was last mirrored in. An
  // in-flight local edit (mid-debounce, not yet saved) is preserved rather than clobbered by an
  // unrelated preference change elsewhere on this page triggering a refetch. Without this guard,
  // toggling a channel checkbox while a quiet-hours edit is still debouncing would silently
  // discard that edit the moment the refetch lands.
  useEffect(() => {
    const next = preferences.quietHours ?? DEFAULT_QUIET_HOURS;
    if (
      syncedQuietHoursRef.current === null ||
      JSON.stringify(quietHoursRef.current) === JSON.stringify(syncedQuietHoursRef.current)
    ) {
      setQuietHours(next);
    }
    syncedQuietHoursRef.current = next;
  }, [preferences.quietHours]);

  // Autosave replaces the former explicit "Save quiet hours" button, matching every other
  // control on this page (and everywhere else in settings): edits persist on a quiet debounce,
  // firing the same patch a button would, and never on mount or for an unchanged value.
  useDebouncedAutosave({
    value: quietHours,
    baseline: preferences.quietHours ?? DEFAULT_QUIET_HOURS,
    save: (next) => {
      void onPatch({ quietHours: next });
    },
  });

  const patchChannel = (
    category: NotificationCategoryValue,
    channel: NotificationChannel,
    next: boolean,
  ): void => {
    if (lockedPreference(category)) return;
    void onPatch({ categories: { [category]: { [channel]: next } } });
  };

  const quietOff = !quietHours.enabled;

  const toggleQuietDay = (day: NotificationQuietHours['days'][number], checked: boolean): void => {
    setQuietHours((current) => {
      const days = new Set(current.days);
      if (checked) days.add(day);
      else days.delete(day);
      return {
        ...current,
        days: QUIET_DAYS.map((item) => item.key).filter((key) => days.has(key)),
      };
    });
  };

  return (
    <section aria-label="Notification preferences" className="flex flex-col gap-6">
      <SettingsGroup
        capability={SETTINGS_NODES.notificationsQuietHours}
        icon={<Schedule aria-hidden="true" className="size-4" />}
        // The switch that gates the whole group belongs to the group, not beside the fields it
        // gates. As a peer of Start and End it was both a second thing called "Quiet hours" —
        // ambiguous to anything resolving that name — and the reason the grid read out of order.
        action={
          <label className="text-on-surface text-label-large coarse:min-h-10 flex items-center gap-2">
            <Checkbox
              checked={quietHours.enabled}
              disabled={saving}
              aria-label="Turn quiet hours on"
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, enabled: event.target.checked }));
              }}
            />
            On
          </label>
        }
      >
        {/* Start and End are a pair and stay one. The previous 2-column step split them across
            rows — "Quiet hours" beside "Start", then "End" beside the save status. */}
        <div className="grid gap-3 @lg:grid-cols-[10rem_10rem_1fr] @lg:items-end">
          <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            Start
            <Input
              type="time"
              aria-label="Quiet hours start"
              value={quietHours.start}
              disabled={saving || quietOff}
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, start: event.target.value }));
              }}
            />
          </label>
          <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            End
            <Input
              type="time"
              aria-label="Quiet hours end"
              value={quietHours.end}
              disabled={saving || quietOff}
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, end: event.target.value }));
              }}
            />
          </label>
          <p aria-live="polite" className="text-on-surface-variant text-body-small h-4">
            {saving ? 'Saving…' : ''}
          </p>
        </div>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {QUIET_DAYS.map((day) => (
              <label key={day.key} className={cn(OPTION_TILE, 'text-body-medium gap-2')}>
                <Checkbox
                  checked={quietHours.days.includes(day.key)}
                  disabled={saving || quietOff}
                  aria-label={`Quiet on ${day.label}`}
                  onChange={(event) => {
                    toggleQuietDay(day.key, event.target.checked);
                  }}
                />
                {day.label.slice(0, 3)}
              </label>
            ))}
          </div>
          <label className={cn(OPTION_TILE, 'text-body-medium w-fit gap-2')}>
            <Checkbox
              checked={quietHours.allowUrgent}
              disabled={saving || quietOff}
              aria-label="Allow urgent notifications"
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, allowUrgent: event.target.checked }));
              }}
            />
            Allow urgent notifications
          </label>
        </div>
      </SettingsGroup>

      <SettingsGroup capability={SETTINGS_NODES.notificationsAdvancedRules} body="rows">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead>
              {/* The header earns a tonal step rather than a rule beneath it: one fill separates
                  it from every row at once, where a hairline is a second mark competing with the
                  checkbox grid it sits over. */}
              <tr className="bg-surface-container">
                <th className="text-on-surface-variant text-label-medium px-4 py-3">Category</th>
                {CHANNELS.map((channel) => (
                  <th
                    key={channel.key}
                    className="text-on-surface-variant text-label-medium px-3 py-3 text-center"
                  >
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((category) => {
                const preference = {
                  ...defaultNotificationChannelPreference(category),
                  ...preferences.categories[category],
                };
                const locked = lockedPreference(category) || preference.locked === true;
                return (
                  <tr
                    key={category}
                    className="even:bg-surface-container hover:bg-surface-container-high transition-colors"
                  >
                    <th className="px-4 py-3">
                      <span className="flex min-w-48 items-center gap-2">
                        <span className="text-on-surface text-label-large">
                          {CATEGORY_LABELS[category]}
                        </span>
                        {locked ? <Badge variant="secondary">Required</Badge> : null}
                      </span>
                    </th>
                    {CHANNELS.map((channel) => {
                      const checked = preference[channel.key] === true;
                      return (
                        <td key={channel.key} className="p-0 text-center">
                          {/* The label is the touch target: it forwards its clicks to the input,
                              so the whole cell is tappable at the coarse floor while the mark
                              stays 16px. */}
                          <label className="coarse:min-h-10 coarse:min-w-10 inline-flex items-center justify-center px-3 py-3">
                            <Checkbox
                              className={cn(locked && 'opacity-70')}
                              aria-label={`${channel.label} for ${CATEGORY_LABELS[category]}`}
                              checked={checked}
                              disabled={locked || saving}
                              onChange={(event) => {
                                patchChannel(category, channel.key, event.target.checked);
                              }}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsGroup>

      {error ? <WriteError message={error} /> : null}
    </section>
  );
}
