'use client';

/**
 * `settings` — the selective personal-data export surface.
 *
 * @remarks
 * Coordinates three typed reads: selectable export options, recent archive history, and an
 * optional email-linked archive. Selection, history rendering, and secure download behavior live
 * in focused adjacent components so this module remains the data-orchestration boundary.
 */
import { Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { api } from '@/lib/api';
import {
  STALE,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

import { type ExportRequestInput } from './export-data-model';
import { ExportHistory } from './export-history';
import { ExportRequestForm } from './export-request-form';

/** Props for {@link ExportDataTab}. */
export interface ExportDataTabProps {
  /** An export linked from email; it is fetched and pinned above the general history. */
  readonly focusedExportId?: string;
}

/** Select data, request an archive, and securely download completed exports. */
export function ExportDataTab({ focusedExportId }: ExportDataTabProps): JSX.Element {
  const optionsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.accountExportOptions(),
      () => api.v1.me.account.exports.options.$get(),
      'Could not load export options.',
      { staleTime: STALE.static },
    ),
  );
  const exportsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.accountExports(),
      () => api.v1.me.account.exports.$get(),
      'Could not load your export history.',
      {
        staleTime: STALE.volatile,
        refetchInterval: (query) =>
          query.state.data?.items.some((exportJob) => exportJob.status === 'pending')
            ? 2000
            : false,
      },
    ),
  );
  const focusedExportQ = useApiQuery(
    apiQueryOptions(
      queryKeys.accountExport(focusedExportId ?? ''),
      () =>
        api.v1.me.account.exports[':exportId'].$get({
          param: { exportId: focusedExportId ?? '' },
        }),
      'Could not load this export.',
      { enabled: Boolean(focusedExportId), staleTime: STALE.volatile },
    ),
  );
  const requestExport = useApiMutation({
    mutationFn: (input: ExportRequestInput) =>
      unwrap(
        () =>
          api.v1.me.account.exports.$post({
            json: { categories: [...input.categories], workspaceIds: [...input.workspaceIds] },
          }),
        'Could not start your data export.',
      ),
    invalidateKeys: [queryKeys.account(), queryKeys.accountExports()],
  });

  const focusedPending = Boolean(focusedExportId) && focusedExportQ.isPending;
  if (optionsQ.isPending || exportsQ.isPending || focusedPending) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (optionsQ.isError || exportsQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body-medium">
        {optionsQ.isError
          ? userErrorMessage(optionsQ.error, 'Could not load export options.')
          : userErrorMessage(exportsQ.error, 'Could not load your export history.')}
      </p>
    );
  }

  const focusedExport = focusedExportQ.data ?? null;
  const history = [
    ...(focusedExport ? [focusedExport] : []),
    ...exportsQ.data.items.filter((exportJob) => exportJob.id !== focusedExportId),
  ].slice(0, 10);
  const hasPendingExport = exportsQ.data.items.some((exportJob) => exportJob.status === 'pending');

  return (
    <section className="flex flex-col gap-8" aria-label="Export data">
      <div className="flex flex-col gap-2">
        <p className="text-on-surface-variant text-body-medium max-w-prose">
          Create a downloadable ZIP file of the Docket data you choose. Exporting does not delete
          anything. Docket captures the selected data when it prepares your export.
        </p>
        {focusedExportQ.isError ? (
          <p role="alert" className="text-destructive text-body-medium">
            This export is no longer available. You can create a new export below.
          </p>
        ) : null}
      </div>

      <ExportRequestForm
        options={optionsQ.data}
        hasPendingExport={hasPendingExport}
        creating={requestExport.isPending}
        error={
          requestExport.isError
            ? userErrorMessage(requestExport.error, 'Could not start your data export.')
            : null
        }
        onCreate={(input) => {
          requestExport.mutate(input);
        }}
      />
      <ExportHistory exports={history} />
    </section>
  );
}
