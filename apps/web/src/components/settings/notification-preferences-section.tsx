'use client';

/**
 * `settings` — caller-owned notification preferences.
 *
 * @remarks
 * A compact preferences surface over the notification-domain DTOs: quiet hours first, then the
 * per-category channel matrix. The domain package owns defaults and locked-category policy; this
 * component only renders that policy and emits structured patches.
 */
import {
  defaultNotificationChannelPreference,
  lockedPreference,
  type NotificationCategory as NotificationCategoryValue,
  type NotificationChannel,
  type NotificationPreferenceOut,
  type NotificationPreferencePatch,
  type NotificationQuietHours,
} from '@docket/notifications';
import { cn } from '@docket/ui';
import { CheckCircle2, Schedule } from '@docket/ui/icons';
import { Badge, Button, Input } from '@docket/ui/primitives';
import { type JSX, useEffect, useState } from 'react';

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

  useEffect(() => {
    setQuietHours(preferences.quietHours ?? DEFAULT_QUIET_HOURS);
  }, [preferences.quietHours]);

  const patchChannel = (
    category: NotificationCategoryValue,
    channel: NotificationChannel,
    next: boolean,
  ): void => {
    if (lockedPreference(category)) return;
    void onPatch({ categories: { [category]: { [channel]: next } } });
  };

  const announcementPreference = {
    ...defaultNotificationChannelPreference('service_announcement'),
    ...preferences.categories['service_announcement'],
  };

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
      <section className="border-outline-variant rounded-lg border p-4">
        <h3 className="text-on-surface text-body font-semibold">
          How should Docket reach me for announcements?
        </h3>
        <div className="mt-3 grid gap-2 @2xl:grid-cols-2">
          <label className="border-outline-variant flex items-center gap-3 rounded-md border px-3 py-2">
            <input
              type="checkbox"
              className="accent-primary size-4 opacity-70"
              checked
              disabled
              aria-label="Announcement web inbox"
            />
            <span className="text-body text-on-surface">Web inbox</span>
          </label>
          {CHANNELS.filter((channel) => channel.key !== 'web').map((channel) => (
            <label
              key={channel.key}
              className="border-outline-variant flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={announcementPreference[channel.key] === true}
                disabled={saving}
                aria-label={`Announcement ${channel.key === 'sms' ? 'text message' : channel.label.toLowerCase()}`}
                onChange={(event) => {
                  patchChannel('service_announcement', channel.key, event.target.checked);
                }}
              />
              <span className="text-body text-on-surface">
                {channel.key === 'sms' ? 'Text message' : channel.label}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="border-outline-variant bg-surface-container-low rounded-lg border">
        <div className="border-outline-variant flex items-center gap-2 border-b px-4 py-3">
          <Schedule aria-hidden="true" className="text-on-surface-variant size-4" />
          <h3 className="text-on-surface text-body font-semibold">Quiet hours</h3>
        </div>
        <div className="grid gap-3 p-4 @2xl:grid-cols-2 @2xl:items-end @4xl:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]">
          <label className="text-on-surface text-body flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={quietHours.enabled}
              disabled={saving}
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, enabled: event.target.checked }));
              }}
            />
            Quiet hours
          </label>
          <label className="text-on-surface-variant flex flex-col gap-1 text-xs">
            Start
            <Input
              type="time"
              aria-label="Quiet hours start"
              value={quietHours.start}
              disabled={saving}
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, start: event.target.value }));
              }}
            />
          </label>
          <label className="text-on-surface-variant flex flex-col gap-1 text-xs">
            End
            <Input
              type="time"
              aria-label="Quiet hours end"
              value={quietHours.end}
              disabled={saving}
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, end: event.target.value }));
              }}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              void onPatch({ quietHours });
            }}
          >
            <CheckCircle2 className="size-4" />
            Save quiet hours
          </Button>
        </div>
        <div className="border-outline-variant grid gap-3 border-t p-4">
          <div className="flex flex-wrap gap-2">
            {QUIET_DAYS.map((day) => (
              <label
                key={day.key}
                className="border-outline-variant text-body flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={quietHours.days.includes(day.key)}
                  disabled={saving}
                  aria-label={`Quiet on ${day.label}`}
                  onChange={(event) => {
                    toggleQuietDay(day.key, event.target.checked);
                  }}
                />
                {day.label.slice(0, 3)}
              </label>
            ))}
          </div>
          <label className="text-on-surface text-body flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={quietHours.allowUrgent}
              disabled={saving}
              aria-label="Allow urgent notifications"
              onChange={(event) => {
                setQuietHours((current) => ({ ...current, allowUrgent: event.target.checked }));
              }}
            />
            Allow urgent notifications
          </label>
        </div>
      </section>

      <section aria-label="Channel preferences" className="flex flex-col gap-3">
        <h3 className="text-on-surface text-body font-semibold">Advanced channel rules</h3>
        <div className="border-outline-variant overflow-x-auto rounded-lg border">
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr className="bg-surface-container-low">
                <th className="text-on-surface-variant px-4 py-3 text-xs font-medium">Category</th>
                {CHANNELS.map((channel) => (
                  <th
                    key={channel.key}
                    className="text-on-surface-variant px-3 py-3 text-center text-xs font-medium"
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
                  <tr key={category} className="border-outline-variant border-t">
                    <th className="border-outline-variant border-t px-4 py-3">
                      <span className="flex min-w-48 items-center gap-2">
                        <span className="text-on-surface text-body font-medium">
                          {CATEGORY_LABELS[category]}
                        </span>
                        {locked ? (
                          <Badge variant="secondary" className="font-normal">
                            Required
                          </Badge>
                        ) : null}
                      </span>
                    </th>
                    {CHANNELS.map((channel) => {
                      const checked = preference[channel.key] === true;
                      return (
                        <td
                          key={channel.key}
                          className="border-outline-variant border-t px-3 py-3 text-center"
                        >
                          <input
                            type="checkbox"
                            className={cn('accent-primary size-4', locked && 'opacity-70')}
                            aria-label={`${channel.label} for ${CATEGORY_LABELS[category]}`}
                            checked={checked}
                            disabled={locked || saving}
                            onChange={(event) => {
                              patchChannel(category, channel.key, event.target.checked);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}
    </section>
  );
}
