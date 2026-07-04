'use client';

/**
 * `settings` — active-sessions (device list) card for the Security tab.
 *
 * @remarks
 * Lists every signed-in device/browser on the account (`GET /v1/me/sessions`), badges the
 * current one, and lets the user **revoke** any other single session or **sign out everywhere
 * else** in one action. This is distinct from passkey management ({@link PasskeysSection}, the
 * credentials that mint a session) and from linked identities (external accounts) — a session is
 * an active login. The current session can't be revoked from this list (the server 409s
 * `current_session`); that's what account sign-out is for. Errors render inline as `role="alert"`
 * banners — there is no toast system.
 */
import type { SessionListOut, SessionOut } from '@docket/types';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** A coarse, dependency-free device label parsed from a session's raw User-Agent string. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const os =
    userAgent.includes('iPhone') || userAgent.includes('iPad')
      ? 'iOS'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('Mac OS X')
          ? 'macOS'
          : userAgent.includes('Windows')
            ? 'Windows'
            : userAgent.includes('Linux')
              ? 'Linux'
              : null;
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Chrome/')
      ? 'Chrome'
      : userAgent.includes('Firefox/')
        ? 'Firefox'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

async function revokeSession(id: string): Promise<SessionOut> {
  return unwrap(
    () => api.v1.me.sessions[':id'].revoke.$post({ param: { id } }),
    'Could not revoke that session.',
  );
}

async function revokeOtherSessions(): Promise<SessionListOut> {
  return unwrap(
    () => api.v1.me.sessions['revoke-others'].$post(),
    'Could not sign out other devices.',
  );
}

/** The Security-tab card that lists and revokes the user's active sessions. */
export function SessionsSection(): JSX.Element {
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const listQ = useApiQuery(
    apiQueryOptions(
      queryKeys.activeSessions(),
      () => api.v1.me.sessions.$get(),
      'Could not load your active sessions.',
    ),
  );

  const revokeOne = useApiMutation({
    mutationFn: revokeSession,
    invalidateKeys: [queryKeys.activeSessions()],
    onSettled: () => {
      setRevokingId(null);
    },
  });

  const revokeOthers = useApiMutation({
    mutationFn: revokeOtherSessions,
    invalidateKeys: [queryKeys.activeSessions()],
  });

  if (listQ.isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (listQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body">
        {listQ.error.message}
      </p>
    );
  }

  const sessions = listQ.data.items;
  const hasOtherSessions = sessions.some((s) => !s.current);

  return (
    <section className="flex flex-col gap-3" aria-label="Active sessions">
      <div className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-on-surface text-body font-medium">Active sessions</h3>
            <p className="text-on-surface-variant text-body max-w-prose">
              Every device currently signed in to your account. If you don&apos;t recognize one,
              revoke it.
            </p>
          </div>
          {hasOtherSessions ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={revokeOthers.isPending}
              onClick={() => {
                revokeOthers.mutate(undefined);
              }}
            >
              {revokeOthers.isPending ? 'Signing out…' : 'Sign out other devices'}
            </Button>
          ) : null}
        </div>

        {revokeOne.isError ? (
          <p role="alert" className="text-destructive text-body">
            {revokeOne.error.message}
          </p>
        ) : null}
        {revokeOthers.isError ? (
          <p role="alert" className="text-destructive text-body">
            {revokeOthers.error.message}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const lastActive = formatCalendarDate(s.updatedAt);
            return (
              <li
                key={s.id}
                className="border-outline-variant bg-surface flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-on-surface text-body truncate font-medium">
                    {deviceLabel(s.userAgent)}
                    {s.current ? (
                      <span className="text-primary ml-2 text-xs font-normal">This device</span>
                    ) : null}
                  </p>
                  <p className="text-on-surface-variant truncate text-xs">
                    {[s.ipAddress, lastActive ? `Active ${lastActive}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {s.current ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={revokeOne.isPending && revokingId === s.id}
                    onClick={() => {
                      setRevokingId(s.id);
                      revokeOne.mutate(s.id);
                    }}
                  >
                    {revokeOne.isPending && revokingId === s.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
