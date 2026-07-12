'use client';

/**
 * Email-safe export destination.
 *
 * @remarks
 * Export-ready emails link here instead of directly to the ZIP endpoint. The authenticated app
 * shell restores the person into Docket, where the export history presents the export and its
 * passkey-protected Download your data action.
 */
import { type JSX, use } from 'react';

import { ExportDataTab } from '@/components/settings/export-data-tab';

/** Render the authenticated export destination linked from export-ready email. */
export default function AccountExportEmailPage({
  params,
}: {
  params: Promise<{ exportId: string }>;
}): JSX.Element {
  const { exportId } = use(params);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-on-surface text-xl font-semibold">Your data export</h1>
        <p className="text-on-surface-variant text-body">
          Verify your identity before downloading your data.
        </p>
      </div>
      <ExportDataTab focusedExportId={exportId} />
    </div>
  );
}
