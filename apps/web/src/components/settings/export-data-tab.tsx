'use client';

/**
 * `settings` — the Export data tab.
 *
 * @remarks
 * Lets the user request a full copy of their Docket data. A request (`POST /v1/me/account/export`)
 * queues an asynchronous job; the export cron generates the archive to blob storage and emails a
 * time-limited link. This tab reflects the latest job's status from `GET /v1/me/account` — polling
 * while it is `pending` — and surfaces the download link (with its expiry) once `ready`. Exporting
 * is non-destructive, so it lives in its own calm section, separate from the Danger zone.
 */
import { Download } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import {
  STALE,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/** The Export data settings tab — request + download a personal-data archive. */
export function ExportDataTab(): JSX.Element {
  const statusQ = useApiQuery(
    apiQueryOptions(
      queryKeys.account(),
      () => api.v1.me.account.$get(),
      'Could not load your export status.',
      {
        staleTime: STALE.volatile,
        // Poll briskly while an export is generating so "ready" appears within a couple seconds.
        refetchInterval: (q) => (q.state.data?.export?.status === 'pending' ? 2000 : false),
      },
    ),
  );

  const requestExport = useApiMutation({
    mutationFn: () =>
      unwrap(() => api.v1.me.account.exports.$post(), 'Could not start your data export.'),
    invalidateKeys: [queryKeys.account()],
  });

  if (statusQ.isPending) {
    return <Skeleton className="h-28 w-full rounded-lg" />;
  }
  if (statusQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body">
        {userErrorMessage(statusQ.error, 'Could not update your data export.')}
      </p>
    );
  }

  const exportJob = statusQ.data.export;
  const downloadUrl = exportJob?.status === 'ready' ? exportJob.downloadUrl : null;

  // Collapse the job into a single view state (the download link, when ready, takes precedence).
  const view = downloadUrl
    ? 'ready'
    : exportJob?.status === 'pending' || requestExport.isPending
      ? 'preparing'
      : exportJob?.status === 'failed'
        ? 'failed'
        : 'idle';

  const requestButton = (label: string, variant?: 'outline') => (
    <Button
      type="button"
      {...(variant ? { variant } : {})}
      disabled={requestExport.isPending}
      onClick={() => {
        requestExport.mutate(undefined);
      }}
    >
      {label}
    </Button>
  );

  return (
    <section className="flex flex-col gap-4" aria-label="Export data">
      <p className="text-on-surface-variant text-body max-w-prose">
        Download a machine-readable archive of everything tied to your account — your profile,
        connected accounts, and every workspace you belong to. We&apos;ll prepare it in the
        background and email you a download link when it&apos;s ready.
      </p>

      {requestExport.isError ? (
        <p role="alert" className="text-destructive text-body">
          {userErrorMessage(requestExport.error, 'Could not update your data export.')}
        </p>
      ) : null}

      <div className="border-outline-variant flex flex-col gap-3 rounded-lg border p-4">
        {view === 'ready' && downloadUrl ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Download className="text-on-surface-variant size-5" aria-hidden />
              <span className="text-on-surface text-body font-medium">Your export is ready</span>
            </div>
            <p className="text-on-surface-variant text-body">
              {exportJob?.expiresAt
                ? `This link expires on ${formatCalendarDate(exportJob.expiresAt) ?? ''}.`
                : 'Download your data below.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={downloadUrl} download>
                  Download your data
                </a>
              </Button>
              {requestButton('Request a fresh export', 'outline')}
            </div>
          </div>
        ) : view === 'preparing' ? (
          <div className="flex flex-col gap-1">
            <span className="text-on-surface text-body font-medium">Preparing your export…</span>
            <p className="text-on-surface-variant text-body">
              This can take a few minutes. We&apos;ll email you when it&apos;s ready — you can leave
              this page.
            </p>
          </div>
        ) : view === 'failed' ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-destructive text-body">
              Your last export didn&apos;t finish. Please try again.
            </p>
            <div>{requestButton('Try again')}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-on-surface-variant text-body">
              {exportJob?.status === 'expired'
                ? 'Your previous download link has expired. Request a new export below.'
                : "You haven't exported your data yet."}
            </p>
            <div>{requestButton('Request export')}</div>
          </div>
        )}
      </div>
    </section>
  );
}
