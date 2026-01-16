'use client';

/**
 * OAuth callback handler for calendar integrations.
 *
 * This page handles the redirect from OAuth providers (Google, Outlook, etc.)
 * after the user grants permission. It:
 * 1. Extracts the authorization code and state from URL params
 * 2. Calls the calendar-sync callback API to exchange the code for tokens
 * 3. Triggers an initial sync to fetch events
 * 4. Redirects back to the integrations page
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';

type CallbackState = 'processing' | 'syncing' | 'success' | 'error';

interface DecodedState {
  provider: CalendarProvider;
  issuedAt: number;
  nonce: string;
}

/**
 * Decode base64url-encoded state parameter.
 */
function decodeState(state: string): DecodedState {
  const [payload] = state.split('.');
  if (!payload) {
    throw new Error('Invalid state');
  }

  // Replace URL-safe chars with standard base64 chars
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64);
  return JSON.parse(decoded) as DecodedState;
}

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<CallbackState>('processing');
  const [error, setError] = useState<string | null>(null);
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double-processing in React strict mode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    // Handle OAuth error (user denied, etc.)
    if (errorParam) {
      setStatus('error');
      setError(
        errorParam === 'access_denied'
          ? 'You cancelled the connection request.'
          : `OAuth error: ${errorParam}`,
      );
      setTimeout(() => {
        router.replace('/settings/integrations');
      }, 2000);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setError('Missing authorization code or state. Please try connecting again.');
      setTimeout(() => {
        router.replace('/settings/integrations');
      }, 2000);
      return;
    }

    async function handleCallback(authCode: string, authState: string) {
      try {
        // Decode state to get provider
        const decodedState = decodeState(authState);
        const { provider } = decodedState;

        // Exchange code for tokens
        setStatus('processing');
        await calendarSyncApi.handleCallback(provider, authCode, authState);

        // Trigger initial sync
        setStatus('syncing');
        await calendarSyncApi.syncAll();

        // Success - redirect back to integrations
        setStatus('success');
        setTimeout(() => {
          router.replace('/settings/integrations');
        }, 1500);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to connect calendar');
        setTimeout(() => {
          router.replace('/settings/integrations');
        }, 3000);
      }
    }

    void handleCallback(code, state);
  }, [searchParams, router]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      <div
        className="space-y-4 text-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={status === 'processing' || status === 'syncing'}
      >
        {status === 'processing' && (
          <>
            <SyncOutlined sx={{ fontSize: 32 }} className="text-primary mx-auto animate-spin" />
            <p className="text-on-surface-variant">Connecting your calendar...</p>
          </>
        )}

        {status === 'syncing' && (
          <>
            <SyncOutlined sx={{ fontSize: 32 }} className="text-primary mx-auto animate-spin" />
            <p className="text-on-surface-variant">Syncing your events...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="bg-tertiary/20 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
              <svg
                className="text-tertiary h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-on-surface font-medium">Calendar connected!</p>
            <p className="text-on-surface-variant text-sm">Redirecting...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="bg-error/20 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
              <svg
                className="text-error h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <p className="text-on-surface font-medium">Connection failed</p>
            <p className="text-on-surface-variant text-sm">{error}</p>
            <p className="text-on-surface-variant text-xs">Redirecting...</p>
          </>
        )}
      </div>
    </div>
  );
}
