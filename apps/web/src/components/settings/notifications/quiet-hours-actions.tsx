'use client';

import { useState, useTransition } from 'react';
import { SettingsRow, SettingsToggleRow } from '@/components/settings/settings-section';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateNotificationPreferences } from '@/lib/notifications-actions';

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'UTC',
];

interface QuietHoursActionsProps {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
}

export function QuietHoursActions({
  quietHoursEnabled: initialEnabled,
  quietHoursStart: initialStart,
  quietHoursEnd: initialEnd,
  quietHoursTimezone: initialTimezone,
}: QuietHoursActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    startTransition(async () => {
      await updateNotificationPreferences({ quietHoursEnabled: checked });
    });
  };

  const handleUpdate = (key: string, value: string) => {
    startTransition(async () => {
      await updateNotificationPreferences({ [key]: value });
    });
  };

  return (
    <div className="divide-outline-variant divide-y">
      <SettingsToggleRow
        label="Enable Quiet Hours"
        description="Silence notifications during set times"
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />

      {enabled && (
        <>
          <SettingsRow label="Start Time" description="When quiet hours begin">
            <Input
              type="time"
              defaultValue={initialStart}
              onBlur={(e) => {
                if (e.target.value !== initialStart) {
                  handleUpdate('quietHoursStart', e.target.value);
                }
              }}
              disabled={isPending}
              className="w-[140px]"
            />
          </SettingsRow>

          <SettingsRow label="End Time" description="When quiet hours end">
            <Input
              type="time"
              defaultValue={initialEnd}
              onBlur={(e) => {
                if (e.target.value !== initialEnd) {
                  handleUpdate('quietHoursEnd', e.target.value);
                }
              }}
              disabled={isPending}
              className="w-[140px]"
            />
          </SettingsRow>

          <SettingsRow label="Timezone" description="Timezone for quiet hours">
            <Select
              defaultValue={initialTimezone}
              onValueChange={(value) => {
                handleUpdate('quietHoursTimezone', value);
              }}
              disabled={isPending}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </>
      )}
    </div>
  );
}
