'use client';

import type { AccountExportOut } from '@docket/types';
import { type JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import { exportScopeSummary, exportStatusCopy } from './export-data-model';
import { SecureExportDownloadButton } from './export-download-button';

/** One archive in the persistent export history. */
function ExportHistoryRow({ exportJob }: { exportJob: AccountExportOut }): JSX.Element {
  const downloadUrl = exportJob.status === 'ready' ? exportJob.downloadUrl : null;
  const requested = formatCalendarDate(exportJob.requestedAt) ?? 'Unknown date';
  const expires = exportJob.expiresAt ? formatCalendarDate(exportJob.expiresAt) : null;

  return (
    <li className="border-outline-variant flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-on-surface text-body-medium font-medium">{exportStatusCopy(exportJob)}</p>
          {exportJob.origin === 'account_deletion' ? (
            <span className="text-on-surface-variant text-xs">Created for account deletion</span>
          ) : null}
        </div>
        <p className="text-on-surface-variant text-body-medium">{exportScopeSummary(exportJob.scope)}</p>
        <p className="text-on-surface-variant text-xs">
          Requested {requested}
          {downloadUrl && expires ? ` · Available until ${expires}` : ''}
        </p>
      </div>

      {downloadUrl ? <SecureExportDownloadButton downloadUrl={downloadUrl} /> : null}
      {exportJob.status === 'pending' ? (
        <p className="text-on-surface-variant text-body-medium">
          You can leave this page. Docket will email you when your export is ready.
        </p>
      ) : null}
      {exportJob.status === 'failed' ? (
        <p className="text-destructive text-body-medium">
          Create a new export above to try again with the data you need.
        </p>
      ) : null}
      {exportJob.status === 'expired' ? (
        <p className="text-on-surface-variant text-body-medium">
          Exports stay available for 14 days. Create a new export to get a fresh link.
        </p>
      ) : null}
    </li>
  );
}

/** Render the newest exports, including any email-linked job pinned by the parent. */
export function ExportHistory({
  exports,
}: {
  readonly exports: readonly AccountExportOut[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <h2 className="text-on-surface text-title-large font-medium">Recent exports</h2>
      {exports.length > 0 ? (
        <ol className="border-outline-variant rounded-lg border px-4 sm:px-6">
          {exports.map((exportJob) => (
            <ExportHistoryRow key={exportJob.id} exportJob={exportJob} />
          ))}
        </ol>
      ) : (
        <p className="text-on-surface-variant text-body-medium">You have not created an export yet.</p>
      )}
    </div>
  );
}
