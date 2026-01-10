'use client';

/**
 * RecurrenceSelector - UI for selecting recurrence patterns.
 *
 * Provides preset options and custom configuration for RRULE-based recurrence.
 */

import { useState, useCallback, useMemo } from 'react';
import RepeatIcon from '@mui/icons-material/Repeat';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  type RecurrenceConfig,
  type RecurrencePreset,
  type WeekdayCode,
  RECURRENCE_PRESETS,
  PRESET_LABELS,
  WEEKDAYS,
  WEEKDAY_SHORT_LABELS,
  buildRRule,
  parseRRule,
  describeRRule,
} from '@/lib/recurrence-utils';

export interface RecurrenceSelectorProps {
  /** Current RRULE string (null = no recurrence) */
  value: string | null;
  /** Callback when recurrence changes */
  onChange: (rrule: string | null) => void;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function RecurrenceSelector({
  value,
  onChange,
  compact = false,
  className,
}: RecurrenceSelectorProps) {
  // Parse current value to determine selected preset or custom
  const currentConfig = useMemo(() => (value ? parseRRule(value) : null), [value]);

  const [showCustom, setShowCustom] = useState(false);
  const [customConfig, setCustomConfig] = useState<RecurrenceConfig>(() => {
    if (currentConfig) return currentConfig;
    return {
      frequency: 'weekly',
      interval: 1,
      endType: 'never',
    };
  });

  // Determine which preset matches the current value
  const selectedPreset = useMemo((): RecurrencePreset | 'custom' => {
    if (!value) return 'none';
    if (!currentConfig) return 'custom';

    // Check if it matches a preset
    for (const [key, preset] of Object.entries(RECURRENCE_PRESETS)) {
      if (!preset) continue;
      if (
        preset.frequency === currentConfig.frequency &&
        preset.interval === currentConfig.interval &&
        currentConfig.endType === 'never'
      ) {
        // Check weekdays for weekdays preset
        if (key === 'weekdays') {
          const weekdayPreset = preset as { byWeekday?: WeekdayCode[] };
          if (
            weekdayPreset.byWeekday?.length === currentConfig.byWeekday?.length &&
            weekdayPreset.byWeekday?.every((d) => currentConfig.byWeekday?.includes(d))
          ) {
            return key as RecurrencePreset;
          }
        } else if (!currentConfig.byWeekday?.length) {
          return key as RecurrencePreset;
        }
      }
    }

    return 'custom';
  }, [value, currentConfig]);

  const handlePresetChange = useCallback(
    (preset: string) => {
      if (preset === 'none') {
        onChange(null);
        setShowCustom(false);
        return;
      }

      if (preset === 'custom') {
        setShowCustom(true);
        // Apply current custom config
        const rrule = buildRRule(customConfig);
        onChange(rrule);
        return;
      }

      const presetConfig = RECURRENCE_PRESETS[preset as RecurrencePreset];
      if (presetConfig) {
        const rrule = buildRRule(presetConfig as RecurrenceConfig);
        onChange(rrule);
        setShowCustom(false);
      }
    },
    [onChange, customConfig],
  );

  const handleCustomConfigChange = useCallback(
    (updates: Partial<RecurrenceConfig>) => {
      const newConfig = { ...customConfig, ...updates };
      setCustomConfig(newConfig);
      const rrule = buildRRule(newConfig);
      onChange(rrule);
    },
    [customConfig, onChange],
  );

  const handleWeekdayToggle = useCallback(
    (day: WeekdayCode) => {
      const currentDays = customConfig.byWeekday ?? [];
      const newDays = currentDays.includes(day)
        ? currentDays.filter((d) => d !== day)
        : [...currentDays, day];
      handleCustomConfigChange({ byWeekday: newDays });
    },
    [customConfig.byWeekday, handleCustomConfigChange],
  );

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <RepeatIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
        <Select value={selectedPreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Does not repeat" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom...</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Preset selector */}
      <div className="space-y-2">
        <Label className="text-on-surface-variant text-sm">Repeat</Label>
        <Select value={selectedPreset} onValueChange={handlePresetChange}>
          <SelectTrigger>
            <SelectValue placeholder="Does not repeat" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom...</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Custom options */}
      {(showCustom || selectedPreset === 'custom') && (
        <div className="bg-surface-container-low space-y-4 rounded-lg p-4">
          {/* Frequency and interval */}
          <div className="flex items-center gap-2">
            <span className="text-on-surface text-sm">Every</span>
            <Input
              type="number"
              min={1}
              max={99}
              value={customConfig.interval}
              onChange={(e) => {
                handleCustomConfigChange({
                  interval: Math.max(1, parseInt(e.target.value, 10) || 1),
                });
              }}
              className="w-16"
            />
            <Select
              value={customConfig.frequency}
              onValueChange={(freq) => {
                handleCustomConfigChange({
                  frequency: freq as RecurrenceConfig['frequency'],
                });
              }}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{customConfig.interval > 1 ? 'days' : 'day'}</SelectItem>
                <SelectItem value="weekly">
                  {customConfig.interval > 1 ? 'weeks' : 'week'}
                </SelectItem>
                <SelectItem value="monthly">
                  {customConfig.interval > 1 ? 'months' : 'month'}
                </SelectItem>
                <SelectItem value="yearly">
                  {customConfig.interval > 1 ? 'years' : 'year'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Weekday selection for weekly */}
          {customConfig.frequency === 'weekly' && (
            <div className="space-y-2">
              <Label className="text-on-surface-variant text-sm">On days</Label>
              <div className="flex gap-1">
                {WEEKDAYS.map((day) => {
                  const isSelected = customConfig.byWeekday?.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        handleWeekdayToggle(day);
                      }}
                      className={cn(
                        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-xs font-medium transition-colors',
                        isSelected
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
                      )}
                    >
                      {WEEKDAY_SHORT_LABELS[day].charAt(0)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* End condition */}
          <div className="space-y-2">
            <Label className="text-on-surface-variant text-sm">Ends</Label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={customConfig.endType === 'never'}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleCustomConfigChange({ endType: 'never' });
                    }
                  }}
                />
                <span className="text-on-surface text-sm">Never</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={customConfig.endType === 'on_date'}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleCustomConfigChange({
                        endType: 'on_date',
                        endDate: customConfig.endDate ?? new Date(),
                      });
                    }
                  }}
                />
                <span className="text-on-surface text-sm">On date</span>
                {customConfig.endType === 'on_date' && (
                  <Input
                    type="date"
                    value={customConfig.endDate?.toISOString().split('T')[0] ?? ''}
                    onChange={(e) => {
                      handleCustomConfigChange({
                        endDate: e.target.value ? new Date(e.target.value) : undefined,
                      });
                    }}
                    className="ml-2 w-40"
                  />
                )}
              </label>

              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={customConfig.endType === 'after_count'}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleCustomConfigChange({
                        endType: 'after_count',
                        endCount: customConfig.endCount ?? 10,
                      });
                    }
                  }}
                />
                <span className="text-on-surface text-sm">After</span>
                {customConfig.endType === 'after_count' && (
                  <>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={customConfig.endCount ?? 10}
                      onChange={(e) => {
                        handleCustomConfigChange({
                          endCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                        });
                      }}
                      className="ml-2 w-20"
                    />
                    <span className="text-on-surface text-sm">occurrences</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Preview */}
          {value && (
            <div className="border-outline-variant/30 border-t pt-3">
              <p className="text-on-surface-variant text-xs">
                <span className="font-medium">Summary:</span> {describeRRule(value)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Show description for preset selections */}
      {value && !showCustom && selectedPreset !== 'custom' && (
        <p className="text-on-surface-variant text-xs">{describeRRule(value)}</p>
      )}
    </div>
  );
}

export default RecurrenceSelector;
