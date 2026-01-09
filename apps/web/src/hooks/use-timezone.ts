'use client';

import { useMemo, useEffect, useState } from 'react';
import { useSettings } from './use-settings';

/**
 * Timezone resolution source.
 */
export type TimezoneSource = 'stored' | 'detected' | 'default';

/**
 * Result of timezone resolution.
 */
export interface ResolvedTimezone {
  /** The resolved timezone identifier (e.g., "America/New_York") */
  timezone: string;
  /** Source of the timezone value */
  source: TimezoneSource;
  /** Browser-detected timezone (may differ from resolved) */
  detectedTimezone: string | null;
  /** Whether the user has explicitly set a timezone (not using default) */
  isExplicitlySet: boolean;
  /** Whether detection differs from stored value */
  detectionDiffers: boolean;
}

/**
 * Detects the user's timezone from the browser.
 * Returns null if detection fails.
 */
function detectBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Hook for resolving user timezone with standardized priority logic.
 *
 * Resolution order:
 * 1. If user has a stored timezone that is NOT 'UTC' (default), use it (explicitly set)
 * 2. If stored timezone is 'UTC' and browser detection available, use detected (suggest to user)
 * 3. Fall back to 'UTC' if detection fails
 *
 * @returns Resolved timezone with metadata about the source
 */
export function useTimezone(): ResolvedTimezone & {
  isLoading: boolean;
  update: (timezone: string) => void;
  isUpdating: boolean;
} {
  const { settings, isLoading: settingsLoading, update, isUpdating } = useSettings();

  // Detect browser timezone on mount
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);

  useEffect(() => {
    // Only detect on client side
    setDetectedTimezone(detectBrowserTimezone());
  }, []);

  const resolved = useMemo((): ResolvedTimezone => {
    const storedTimezone = settings?.timezone ?? 'UTC';
    const detected = detectedTimezone;

    // If stored timezone differs from default 'UTC', user has explicitly set it
    const isExplicitlySet = storedTimezone !== 'UTC';

    let timezone: string;
    let source: TimezoneSource;

    if (isExplicitlySet) {
      // User has explicitly set a non-default timezone
      timezone = storedTimezone;
      source = 'stored';
    } else if (detected) {
      // Stored is default 'UTC' but we detected from browser - use detected
      timezone = detected;
      source = 'detected';
    } else {
      // Fallback to default
      timezone = 'UTC';
      source = 'default';
    }

    return {
      timezone,
      source,
      detectedTimezone: detected,
      isExplicitlySet,
      detectionDiffers: detected !== null && detected !== storedTimezone,
    };
  }, [settings?.timezone, detectedTimezone]);

  const handleUpdate = (timezone: string) => {
    update({ timezone });
  };

  return {
    ...resolved,
    isLoading: settingsLoading,
    update: handleUpdate,
    isUpdating,
  };
}

/**
 * Returns the browser-detected timezone without any resolution logic.
 * Useful for showing "detected" timezone to users.
 */
export function useDetectedTimezone(): string | null {
  const [timezone, setTimezone] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(detectBrowserTimezone());
  }, []);

  return timezone;
}
