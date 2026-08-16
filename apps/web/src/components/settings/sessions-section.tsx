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
import { LoadFailure } from './load-failure';
import { Computer, Phone } from '@docket/ui/icons';
import { Badge, Button, DecorativeIcon, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { SettingRow } from './setting-row';
import { SettingsGroup } from './settings-group';

/** A coarse, dependency-free device label parsed from a session's raw User-Agent string. */
/**
 * Whether an address is worth showing beside a session.
 *
 * @remarks
 * A local or unspecified address renders as `0000:0000:0000:0000:0000:0000:0000:0000` or `::1`,
 * which is the widest thing on the row and tells the reader nothing. The row exists so somebody
 * can recognize a device; an address that identifies nothing is noise sitting where the
 * identifying detail should be.
 *
 * @param ip - The session's recorded address, if any.
 * @returns whether to render it.
 */
function isMeaningfulAddress(ip: string | null): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();
  if (normalized === '::1' || normalized === '127.0.0.1' || normalized === '::') return false;
  // An all-zero IPv6 address in any of its written forms.
  return !/^(0{1,4}:){7}0{1,4}$/.test(normalized);
}

/**
 * The glyph that anchors a session row.
 *
 * @param userAgent - The session's user agent.
 * @returns a device-shaped icon so the list has one column the eye can run down.
 */
function deviceIcon(userAgent: string | null): typeof Computer {
  if (userAgent === null) return Computer;
  return userAgent.includes('iPhone') || userAgent.includes('Android') ? Phone : Computer;
}

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
  // Signing out every other device reaches machines the person is not holding, so it asks
  // first. Revoking a single session stays a one-click row action — its blast radius is the
  // one row you are pointing at.
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

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
    // placeholder: the account's active sessions — which devices are signed in, from where, and
    // when they were last seen. Nothing about another device's session is knowable locally.
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (listQ.isError) {
    return (
      <LoadFailure
        message={userErrorMessage(listQ.error, 'Could not load your sessions.')}
        retrying
      />
    );
  }

  const sessions = listQ.data.items;
  const hasOtherSessions = sessions.some((s) => !s.current);

  return (
    <section className="flex flex-col gap-3" aria-label="Active sessions">
      <SettingsGroup
        title="Active sessions"
        description="Every device currently signed in to your account. Revoke any you don't recognize."
        body="rows"
        action={
          hasOtherSessions ? (
            <Button
              type="button"
              variant="outline"
              disabled={revokeOthers.isPending}
              onClick={() => {
                setConfirmSignOutAll(true);
              }}
            >
              {revokeOthers.isPending ? 'Signing out…' : 'Sign out other devices'}
            </Button>
          ) : undefined
        }
      >
        {revokeOne.isError ? (
          <p role="alert" className="text-error text-body-medium px-4 pb-2">
            {userErrorMessage(revokeOne.error, 'Could not update your sessions.')}
          </p>
        ) : null}
        <ul>
          {sessions.map((s) => {
            const lastActive = formatCalendarDate(s.updatedAt);
            return (
              <SettingRow
                key={s.id}
                as="li"
                leading={<DecorativeIcon icon={deviceIcon(s.userAgent)} />}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-on-surface text-label-large truncate">
                      {deviceLabel(s.userAgent)}
                    </span>
                    {s.current ? <Badge variant="secondary">This device</Badge> : null}
                  </span>
                }
                description={[
                  lastActive ? `Active ${lastActive}` : null,
                  isMeaningfulAddress(s.ipAddress) ? s.ipAddress : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {...(s.current
                  ? {}
                  : {
                      trailing: (
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
                      ),
                    })}
              />
            );
          })}
        </ul>
      </SettingsGroup>

      <ConfirmDestructiveDialog
        open={confirmSignOutAll}
        onOpenChange={setConfirmSignOutAll}
        title="Sign out other devices?"
        description="Every other signed-in device is signed out. This device stays signed in."
        confirmLabel="Sign out other devices"
        pending={revokeOthers.isPending}
        {...(revokeOthers.isError
          ? { error: userErrorMessage(revokeOthers.error, 'Could not update your sessions.') }
          : {})}
        onConfirm={() => {
          revokeOthers.mutate(undefined, {
            onSuccess: () => {
              setConfirmSignOutAll(false);
            },
          });
        }}
      />
    </section>
  );
}
