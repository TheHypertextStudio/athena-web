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
import { getTimezoneInfo } from '@/lib/timezone-utils';

const COMMON_TIMEZONES: { value: string; label: string; region: string }[] = [
  // UTC
  { value: 'UTC', label: 'UTC', region: 'UTC' },

  // Americas - North
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)', region: 'Americas' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)', region: 'Americas' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', region: 'Americas' },
  { value: 'America/Anchorage', label: 'Alaska Time', region: 'Americas' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', region: 'Americas' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)', region: 'Americas' },
  { value: 'America/Toronto', label: 'Toronto', region: 'Americas' },
  { value: 'America/Vancouver', label: 'Vancouver', region: 'Americas' },

  // Americas - Central & South
  { value: 'America/Mexico_City', label: 'Mexico City', region: 'Americas' },
  { value: 'America/Bogota', label: 'Bogota', region: 'Americas' },
  { value: 'America/Lima', label: 'Lima', region: 'Americas' },
  { value: 'America/Santiago', label: 'Santiago', region: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'Sao Paulo', region: 'Americas' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires', region: 'Americas' },
  { value: 'America/Caracas', label: 'Caracas', region: 'Americas' },

  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)', region: 'Europe' },
  { value: 'Europe/Dublin', label: 'Dublin', region: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris', region: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin', region: 'Europe' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Brussels', label: 'Brussels', region: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid', region: 'Europe' },
  { value: 'Europe/Rome', label: 'Rome', region: 'Europe' },
  { value: 'Europe/Zurich', label: 'Zurich', region: 'Europe' },
  { value: 'Europe/Stockholm', label: 'Stockholm', region: 'Europe' },
  { value: 'Europe/Oslo', label: 'Oslo', region: 'Europe' },
  { value: 'Europe/Helsinki', label: 'Helsinki', region: 'Europe' },
  { value: 'Europe/Warsaw', label: 'Warsaw', region: 'Europe' },
  { value: 'Europe/Prague', label: 'Prague', region: 'Europe' },
  { value: 'Europe/Vienna', label: 'Vienna', region: 'Europe' },
  { value: 'Europe/Athens', label: 'Athens', region: 'Europe' },
  { value: 'Europe/Istanbul', label: 'Istanbul', region: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow', region: 'Europe' },
  { value: 'Europe/Kyiv', label: 'Kyiv', region: 'Europe' },

  // Africa
  { value: 'Africa/Cairo', label: 'Cairo', region: 'Africa' },
  { value: 'Africa/Lagos', label: 'Lagos', region: 'Africa' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg', region: 'Africa' },
  { value: 'Africa/Nairobi', label: 'Nairobi', region: 'Africa' },
  { value: 'Africa/Casablanca', label: 'Casablanca', region: 'Africa' },
  { value: 'Africa/Accra', label: 'Accra', region: 'Africa' },
  { value: 'Africa/Addis_Ababa', label: 'Addis Ababa', region: 'Africa' },
  { value: 'Africa/Algiers', label: 'Algiers', region: 'Africa' },
  { value: 'Africa/Tunis', label: 'Tunis', region: 'Africa' },
  { value: 'Africa/Dar_es_Salaam', label: 'Dar es Salaam', region: 'Africa' },

  // Middle East
  { value: 'Asia/Dubai', label: 'Dubai', region: 'Middle East' },
  { value: 'Asia/Riyadh', label: 'Riyadh', region: 'Middle East' },
  { value: 'Asia/Jerusalem', label: 'Jerusalem', region: 'Middle East' },
  { value: 'Asia/Tehran', label: 'Tehran', region: 'Middle East' },
  { value: 'Asia/Baghdad', label: 'Baghdad', region: 'Middle East' },
  { value: 'Asia/Kuwait', label: 'Kuwait', region: 'Middle East' },
  { value: 'Asia/Qatar', label: 'Doha', region: 'Middle East' },

  // Asia - South
  { value: 'Asia/Kolkata', label: 'India (IST)', region: 'Asia' },
  { value: 'Asia/Mumbai', label: 'Mumbai', region: 'Asia' },
  { value: 'Asia/Karachi', label: 'Karachi', region: 'Asia' },
  { value: 'Asia/Dhaka', label: 'Dhaka', region: 'Asia' },
  { value: 'Asia/Colombo', label: 'Colombo', region: 'Asia' },
  { value: 'Asia/Kathmandu', label: 'Kathmandu', region: 'Asia' },

  // Asia - Southeast
  { value: 'Asia/Singapore', label: 'Singapore', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City', region: 'Asia' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Manila', region: 'Asia' },

  // Asia - East
  { value: 'Asia/Shanghai', label: 'China (CST)', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Taipei', label: 'Taipei', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', region: 'Asia' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)', region: 'Asia' },

  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney (AEST)', region: 'Oceania' },
  { value: 'Australia/Melbourne', label: 'Melbourne', region: 'Oceania' },
  { value: 'Australia/Brisbane', label: 'Brisbane (no DST)', region: 'Oceania' },
  { value: 'Australia/Perth', label: 'Perth (AWST)', region: 'Oceania' },
  { value: 'Australia/Adelaide', label: 'Adelaide', region: 'Oceania' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)', region: 'Oceania' },
  { value: 'Pacific/Fiji', label: 'Fiji', region: 'Oceania' },
  { value: 'Pacific/Guam', label: 'Guam', region: 'Oceania' },
];

const REGION_ORDER = ['UTC', 'Americas', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania'];

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
