'use client';

/**
 * `settings` — the Danger zone tab (account deletion).
 *
 * @remarks
 * Reads the account end-of-life status (`GET /v1/me/account`) and renders, in order of urgency:
 * (1) a **pending-deletion banner** with a live countdown + one-click cancel when deletion is
 * scheduled; (2) the **ownership-blocker guide** listing shared workspaces the user solely owns,
 * each linking to that workspace's Members settings to transfer or remove ownership; and (3) the
 * **delete-account card**, whose action is disabled while any blocker remains. The destructive
 * confirmation (email gate + passkey step-up) lives in {@link DeleteAccountDialog}. Errors render
 * inline as `role="alert"` banners (there is no toast system).
 */
import type { AccountStatusOut } from '@docket/types';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { formatCalendarDate } from '@/lib/format-date';
import {
  STALE,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import { DeleteAccountDialog } from './delete-account-dialog';
import { sectionHref } from './sections';
import { userErrorMessage } from '@/lib/problem';

/** Whole days from now until an ISO instant (floored at 0). */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** The Danger zone settings tab — schedule / cancel account deletion. */
export function DangerZoneTab(): JSX.Element {
  const session = useSession();
  const email = session.data?.user.email ?? '';
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusQ = useApiQuery(
    apiQueryOptions(
      queryKeys.account(),
      () => api.v1.me.account.$get(),
      'Could not load your account status.',
      { staleTime: STALE.volatile },
    ),
  );

  const cancelDeletion = useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.account.reactivation.$post(),
        'Could not cancel your scheduled deletion.',
      ),
    invalidateKeys: [queryKeys.account()],
  });

  if (statusQ.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (statusQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body">
        {userErrorMessage(statusQ.error, 'Could not update account settings.')}
      </p>
    );
  }

  const status: AccountStatusOut = statusQ.data;
  const pending = status.deletionState === 'pending_deletion';
  const blockers = status.blockers;

  return (
    <section className="flex flex-col gap-6" aria-label="Danger zone">
      {/* Pending-deletion banner */}
      {pending && status.deleteAfterAt ? (
        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-on-surface text-body font-medium">
              Your account is scheduled for deletion
            </h3>
            <p className="text-on-surface-variant text-body">
              It will be permanently deleted on{' '}
              <span className="text-on-surface font-medium">
                {formatCalendarDate(status.deleteAfterAt)}
              </span>{' '}
              ({daysUntil(status.deleteAfterAt)} days left). Cancel any time before then to restore
              everything.
            </p>
          </div>
          {cancelDeletion.isError ? (
            <p role="alert" className="text-destructive text-body">
              {userErrorMessage(cancelDeletion.error, 'Could not update account settings.')}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              disabled={cancelDeletion.isPending}
              onClick={() => {
                cancelDeletion.mutate(undefined);
              }}
            >
              {cancelDeletion.isPending ? 'Cancelling…' : 'Cancel deletion'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Ownership-blocker guide */}
      {!pending && blockers.length > 0 ? (
        <div className="border-outline-variant flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-on-surface text-body font-medium">
              Resolve these workspaces first
            </h3>
            <p className="text-on-surface-variant text-body max-w-prose">
              You&apos;re the only owner of{' '}
              {blockers.length === 1 ? 'a shared workspace' : 'some shared workspaces'} with other
              members. Transfer ownership (or delete the workspace) so it isn&apos;t left without an
              owner, then you can delete your account.
            </p>
          </div>
          <ul className="border-outline-variant divide-outline-variant flex flex-col divide-y rounded-md border">
            {blockers.map((b) => (
              <li
                key={b.organizationId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-on-surface text-body truncate font-medium">{b.name}</span>
                  <span className="text-on-surface-variant text-xs">
                    {b.memberCount} members · you&apos;re the only owner
                  </span>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={sectionHref(b.organizationId, 'members')}>Manage members</Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Delete account card */}
      {!pending ? (
        <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-on-surface text-body font-medium">Delete account</h3>
            <p className="text-on-surface-variant text-body max-w-prose">
              Permanently delete your Docket account, your personal workspace, and any workspace
              only you belong to. You&apos;ll have 14 days to change your mind. Want a copy first?
              Use <span className="text-on-surface font-medium">Export data</span> before you
              delete.
            </p>
          </div>
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={blockers.length > 0 || !email}
              onClick={() => {
                setDialogOpen(true);
              }}
            >
              Delete account…
            </Button>
          </div>
        </div>
      ) : null}

      <DeleteAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} email={email} />
    </section>
  );
}
