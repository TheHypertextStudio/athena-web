'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import { useTimezone } from '@/hooks/use-timezone';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Get timezone display info for a given timezone identifier.
 */
function getTimezoneDisplayInfo(timezone: string): { label: string; offset: string; time: string } {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const time = formatter.format(now);

    // Calculate offset
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const diffMinutes = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
    const diffHours = Math.floor(Math.abs(diffMinutes) / 60);
    const diffMins = Math.abs(diffMinutes) % 60;
    const sign = diffMinutes >= 0 ? '+' : '-';
    const offset =
      diffMins > 0
        ? `UTC${sign}${String(diffHours)}:${diffMins.toString().padStart(2, '0')}`
        : `UTC${sign}${String(diffHours)}`;

    // Format label from timezone ID
    const label = timezone.replace(/_/g, ' ').replace(/\//g, ' / ');

    return { label, offset, time };
  } catch {
    return { label: timezone, offset: 'UTC', time: '--:--' };
  }
}

/**
 * App-wide dialog that prompts the user when their detected timezone
 * differs from their stored preference.
 *
 * Place this component in a top-level layout to show on app load.
 */
export function TimezoneMismatchDialog() {
  const {
    timezone: storedTimezone,
    detectedTimezone,
    detectionDiffers,
    isExplicitlySet,
    isLoading,
    update,
    isUpdating,
  } = useTimezone();

  const [dismissed, setDismissed] = useState(false);

  // Track the initial stored timezone to detect intentional changes
  const initialTimezoneRef = useRef<string | null>(null);
  const [userChangedTimezone, setUserChangedTimezone] = useState(false);

  // Capture the initial timezone on first load
  useEffect(() => {
    if (!isLoading && initialTimezoneRef.current === null) {
      initialTimezoneRef.current = storedTimezone;
    }
  }, [isLoading, storedTimezone]);

  // Detect when user intentionally changes timezone (stored differs from initial)
  useEffect(() => {
    if (initialTimezoneRef.current !== null && storedTimezone !== initialTimezoneRef.current) {
      setUserChangedTimezone(true);
    }
  }, [storedTimezone]);

  const shouldShow =
    !isLoading &&
    detectionDiffers &&
    isExplicitlySet &&
    detectedTimezone !== null &&
    !dismissed &&
    !userChangedTimezone;

  const storedInfo = useMemo(() => getTimezoneDisplayInfo(storedTimezone), [storedTimezone]);

  const detectedInfo = useMemo(
    () => (detectedTimezone ? getTimezoneDisplayInfo(detectedTimezone) : null),
    [detectedTimezone],
  );

  const handleUpdateTimezone = () => {
    if (detectedTimezone) {
      update(detectedTimezone);
    }
    setDismissed(true);
  };

  const handleKeepCurrent = () => {
    setDismissed(true);
  };

  if (!shouldShow || !detectedInfo) {
    return null;
  }

  const storedShortLabel = storedInfo.label.split(' / ').pop() ?? storedInfo.label;
  const detectedShortLabel = detectedInfo.label.split(' / ').pop() ?? detectedInfo.label;

  return (
    <AlertDialog
      open={shouldShow}
      onOpenChange={(open) => {
        if (!open) {
          setDismissed(true);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MyLocationOutlinedIcon sx={{ fontSize: 20 }} />
            Timezone Mismatch Detected
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Your device timezone appears to be different from your saved preference.</p>
              <div className="bg-surface-container space-y-2 rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-on-surface-variant">Saved:</span>
                  <span className="text-on-surface font-medium">
                    {storedInfo.label} ({storedInfo.offset})
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-on-surface-variant">Detected:</span>
                  <span className="text-on-surface font-medium">
                    {detectedInfo.label} ({detectedInfo.offset})
                  </span>
                </div>
              </div>
              <p className="text-sm">
                Would you like to update your timezone to match your current location?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleKeepCurrent} disabled={isUpdating}>
            Keep {storedShortLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleUpdateTimezone} disabled={isUpdating}>
            {isUpdating ? 'Updating...' : `Switch to ${detectedShortLabel}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
