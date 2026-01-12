'use client';

/**
 * Calendar selection component for managing which calendars to sync.
 *
 * Allows users to toggle sync on/off for individual calendars and
 * choose the sync direction (pull, push, or bidirectional).
 */

import { useState } from 'react';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import { calendarSyncApi, type SyncedCalendar, type SyncDirection } from '@/lib/api-client';
import { Switch } from '@/components/ui/switch';
import { Surface } from '@/components/ui/surface';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CalendarSelectionProps {
  connectionId: string;
  calendars: SyncedCalendar[];
  onUpdate: () => void;
}

const SYNC_DIRECTION_LABELS: Record<SyncDirection, string> = {
  pull: 'Import only',
  push: 'Export only',
  bidirectional: 'Two-way sync',
};

/**
 * Calendar selection UI for managing which calendars to sync.
 *
 * @param props - Calendar selection props.
 */
export function CalendarSelection({ connectionId, calendars, onUpdate }: CalendarSelectionProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  const handleToggleSync = async (calendarId: string, enabled: boolean) => {
    const calendar = calendars.find((c) => c.id === calendarId);
    if (!calendar) return;

    setUpdating(calendarId);
    try {
      await calendarSyncApi.updateSettings(connectionId, [
        {
          id: calendarId,
          syncEnabled: enabled,
          syncDirection: calendar.syncDirection,
        },
      ]);
      onUpdate();
    } catch (err) {
      console.error('Failed to update calendar sync settings:', err);
    } finally {
      setUpdating(null);
    }
  };

  const handleDirectionChange = async (calendarId: string, direction: SyncDirection) => {
    const calendar = calendars.find((c) => c.id === calendarId);
    if (!calendar) return;

    setUpdating(calendarId);
    try {
      await calendarSyncApi.updateSettings(connectionId, [
        {
          id: calendarId,
          syncEnabled: calendar.syncEnabled,
          syncDirection: direction,
        },
      ]);
      onUpdate();
    } catch (err) {
      console.error('Failed to update sync direction:', err);
    } finally {
      setUpdating(null);
    }
  };

  if (calendars.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-on-surface mb-3 flex items-center gap-2 font-medium">
        <CalendarTodayOutlinedIcon sx={{ fontSize: 18 }} />
        Calendars
      </h3>
      <div className="space-y-2">
        {calendars.map((calendar) => {
          const canEdit = calendar.canEdit !== false;

          return (
            <Surface key={calendar.id} elevation="high" padding="sm" rounded="sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {/* Calendar color indicator */}
                  {calendar.color && (
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-on-surface flex items-center gap-2 font-medium">
                      <span className="truncate">{calendar.name}</span>
                      {calendar.isPrimary && (
                        <span className="bg-primary/10 text-primary shrink-0 rounded px-1.5 py-0.5 text-xs">
                          Primary
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sync toggle */}
                <Switch
                  checked={calendar.syncEnabled}
                  onCheckedChange={(checked) => {
                    void handleToggleSync(calendar.id, checked);
                  }}
                  disabled={updating === calendar.id}
                  aria-label={`Sync ${calendar.name}`}
                />
              </div>

              {/* Sync direction (only show when enabled) */}
              {calendar.syncEnabled && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-on-surface-variant text-sm">Sync mode</span>
                  <Select
                    value={calendar.syncDirection}
                    onValueChange={(value) => {
                      void handleDirectionChange(calendar.id, value as SyncDirection);
                    }}
                    disabled={updating === calendar.id || !canEdit}
                  >
                    <SelectTrigger
                      className="w-[140px]"
                      aria-label={`Sync mode for ${calendar.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pull">{SYNC_DIRECTION_LABELS.pull}</SelectItem>
                      {canEdit && (
                        <>
                          <SelectItem value="bidirectional">
                            {SYNC_DIRECTION_LABELS.bidirectional}
                          </SelectItem>
                          <SelectItem value="push">{SYNC_DIRECTION_LABELS.push}</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
