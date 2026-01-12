'use client';

/**
 * Calendar credentials dialog for iCloud and CalDAV connections.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';

interface CalendarCredentialsDialogProps {
  provider: CalendarProvider;
  state: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: 'Google',
  outlook: 'Microsoft',
  icloud: 'Apple',
  caldav: 'CalDAV',
};

const encodeBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/**
 * Render a credential entry dialog for CalDAV/iCloud connections.
 *
 * @param props - Calendar credential dialog props.
 */
export function CalendarCredentialsDialog({
  provider,
  state,
  open,
  onOpenChange,
  onSuccess,
}: CalendarCredentialsDialogProps) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCalDav = provider === 'caldav';
  const dialogTitle = useMemo(() => {
    return isCalDav ? 'Connect CalDAV' : 'Connect Apple Calendar';
  }, [isCalDav]);

  useEffect(() => {
    if (open) {
      setError(null);
      setIsSubmitting(false);
      setServerUrl('');
      setUsername('');
      setPassword('');
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!state) {
      setError('Missing authorization state. Please try connecting again.');
      return;
    }

    setIsSubmitting(true);

    try {
      let code = '';
      if (isCalDav) {
        if (!serverUrl || !username || !password) {
          throw new Error('Server URL, username, and password are required.');
        }
        code = encodeBase64(JSON.stringify({ serverUrl, username, password }));
      } else {
        if (!username || !password) {
          throw new Error('Apple ID and app-specific password are required.');
        }
        code = encodeBase64(`${username}:${password}`);
      }

      const result = await calendarSyncApi.handleCallback(provider, code, state);
      await calendarSyncApi.triggerSync(result.data.id);

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect calendar');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {isCalDav
              ? 'Enter your CalDAV server details to connect your calendar.'
              : 'Use your Apple ID and an app-specific password to connect iCloud.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <div className="space-y-4 py-2">
            {isCalDav && (
              <div>
                <Label htmlFor="caldav-server-url" className="text-on-surface">
                  CalDAV Server URL
                </Label>
                <Input
                  id="caldav-server-url"
                  value={serverUrl}
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                  }}
                  placeholder="https://caldav.example.com"
                  className="mt-2"
                  autoComplete="url"
                />
              </div>
            )}

            <div>
              <Label htmlFor="calendar-username" className="text-on-surface">
                {isCalDav ? 'Username' : 'Apple ID'}
              </Label>
              <Input
                id="calendar-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                }}
                placeholder={isCalDav ? 'user@example.com' : 'your@icloud.com'}
                className="mt-2"
                autoComplete={isCalDav ? 'username' : 'email'}
              />
            </div>

            <div>
              <Label htmlFor="calendar-password" className="text-on-surface">
                {isCalDav ? 'Password' : 'App-Specific Password'}
              </Label>
              <Input
                id="calendar-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                placeholder={isCalDav ? '••••••••' : 'xxxx-xxxx-xxxx-xxxx'}
                className="mt-2"
                autoComplete={isCalDav ? 'current-password' : 'one-time-code'}
              />
            </div>

            {error && <p className="text-error text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="filled" disabled={isSubmitting}>
              {isSubmitting ? `Connecting ${PROVIDER_LABELS[provider]}...` : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
