'use client';

import type { AccountExportOut } from '@docket/types';
import { type JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import { exportScopeSummary, exportStatusCopy } from './export-data-model';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { SecureExportDownloadButton } from './export-download-button';

/** One archive in the persistent export history. */
function ExportHistoryRow({ exportJob }: { exportJob: AccountExportOut }): JSX.Element {
  const downloadUrl = exportJob.status === 'ready' ? exportJob.downloadUrl : null;
  const requested = formatCalendarDate(exportJob.requestedAt) ?? 'Unknown date';
  const expires = exportJob.expiresAt ? formatCalendarDate(exportJob.expiresAt) : null;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-on-surface text-label-large">{exportStatusCopy(exportJob)}</p>
          {exportJob.origin === 'account_deletion' ? (
            <span className="text-on-surface-variant text-body-small">
              Created for account deletion
            </span>
          ) : null}
        </div>
        <p className="text-on-surface-variant text-body-medium">
          {exportScopeSummary(exportJob.scope)}
        </p>
        <p className="text-on-surface-variant text-body-small">
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
        <p className="text-error text-body-medium">
          Create a new export above with the data you need.
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
    <SettingsGroup capability={SETTINGS_NODES.dataExportHistory} body="rows" aria-live="polite">
      {exports.length > 0 ? (
        <ol>
          {exports.map((exportJob) => (
            <ExportHistoryRow key={exportJob.id} exportJob={exportJob} />
          ))}
        </ol>
      ) : (
        <p className="text-on-surface-variant text-body-medium px-4 py-3">
          You have not created an export yet. Choose what to include above, and it will appear here.
        </p>
      )}
    </SettingsGroup>
  );
}
