'use client';

import { useState, useEffect, useMemo, useTransition } from 'react';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import { SettingsRow } from '@/components/settings/settings-section';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateSettings } from '@/lib/account-actions';
import { getTimezoneInfo, COMMON_TIMEZONES, REGION_ORDER } from '@/lib/timezone-utils';

function detectBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

interface PreferencesActionsProps {
  storedTimezone: string;
  dailyPlanningTime: string | null;
  dailyReviewTime: string | null;
}

export function PreferencesActions({
  storedTimezone,
  dailyPlanningTime,
  dailyReviewTime,
}: PreferencesActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);

  // Detect browser timezone on mount
  useEffect(() => {
    setDetectedTimezone(detectBrowserTimezone());
  }, []);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Resolve timezone: use stored if not UTC, otherwise use detected
  const isExplicitlySet = storedTimezone !== 'UTC';
  const resolvedTimezone = isExplicitlySet ? storedTimezone : (detectedTimezone ?? 'UTC');
  const timezoneSource = isExplicitlySet ? 'stored' : detectedTimezone ? 'detected' : 'default';

  // Memoize timezone options with current time info
  const timezoneOptions = useMemo(() => {
    return COMMON_TIMEZONES.map((tz) => {
      const info = getTimezoneInfo(tz.value, currentTime);
      return { ...tz, ...info };
    });
  }, [currentTime]);

  // Group and sort timezones
  const groupedTimezones = useMemo(() => {
    const groups = new Map<string, typeof timezoneOptions>();
    for (const tz of timezoneOptions) {
      const existing = groups.get(tz.region);
      if (existing) {
        existing.push(tz);
      } else {
        groups.set(tz.region, [tz]);
      }
    }
    for (const [region, tzList] of groups) {
      tzList.sort((a, b) => a.offsetMinutes - b.offsetMinutes);
      groups.set(region, tzList);
    }
    return groups;
  }, [timezoneOptions]);

  const handleTimezoneChange = (timezone: string) => {
    startTransition(async () => {
      await updateSettings({ timezone });
    });
  };

  const handlePlanningTimeChange = (time: string) => {
    startTransition(async () => {
      await updateSettings({ dailyPlanningTime: time || null });
    });
  };

  const handleReviewTimeChange = (time: string) => {
    startTransition(async () => {
      await updateSettings({ dailyReviewTime: time || null });
    });
  };

  return (
    <div className="divide-outline-variant divide-y">
      <SettingsRow
        label="Timezone"
        description={
          timezoneSource === 'detected'
            ? 'Auto-detected from your browser. Select to confirm or change.'
            : 'Used for scheduling and reminders'
        }
      >
        <div className="flex items-center gap-2">
          <Select
            value={resolvedTimezone}
            onValueChange={handleTimezoneChange}
            disabled={isPending}
          >
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select timezone">
                {(() => {
                  const selected = timezoneOptions.find((tz) => tz.value === resolvedTimezone);
                  return selected ? `${selected.label} (${selected.offset})` : resolvedTimezone;
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[400px]">
              {REGION_ORDER.map((region) => {
                const regionTimezones = groupedTimezones.get(region);
                if (!regionTimezones || regionTimezones.length === 0) return null;
                return (
                  <div key={region}>
                    <div className="text-muted-foreground px-2 py-1.5 text-xs font-semibold">
                      {region}
                    </div>
                    {regionTimezones.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        <div className="flex w-full items-center justify-between gap-4">
                          <span>{tz.label}</span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {tz.offset} · {tz.time}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </div>
                );
              })}
            </SelectContent>
          </Select>
          {timezoneSource === 'detected' && (
            <span
              className="bg-tertiary/10 text-tertiary flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              title="Timezone detected from your browser"
            >
              <MyLocationOutlinedIcon sx={{ fontSize: 14 }} />
              Detected
            </span>
          )}
        </div>
      </SettingsRow>

      <SettingsRow label="Daily Planning Time" description="When to remind you to plan your day">
        <Input
          type="time"
          defaultValue={dailyPlanningTime ?? ''}
          onBlur={(e) => {
            if (e.target.value !== (dailyPlanningTime ?? '')) {
              handlePlanningTimeChange(e.target.value);
            }
          }}
          disabled={isPending}
          className="w-[140px]"
        />
      </SettingsRow>

      <SettingsRow label="Daily Review Time" description="When to remind you to review your day">
        <Input
          type="time"
          defaultValue={dailyReviewTime ?? ''}
          onBlur={(e) => {
            if (e.target.value !== (dailyReviewTime ?? '')) {
              handleReviewTimeChange(e.target.value);
            }
          }}
          disabled={isPending}
          className="w-[140px]"
        />
      </SettingsRow>
    </div>
  );
}
