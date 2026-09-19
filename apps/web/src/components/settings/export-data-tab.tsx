'use client';

/**
 * `settings` — the selective personal-data export surface.
 *
 * @remarks
 * Coordinates three typed reads: selectable export options, recent archive history, and an
 * optional email-linked archive. Selection, history rendering, and secure download behavior live
 * in focused adjacent components so this module remains the data-orchestration boundary.
 */
import { InlineBanner } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { LoadFailure } from '@/components/feedback';
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

import { type ExportRequestInput } from './export-data-model';
import { ExportHistory } from './export-history';
import { ExportRequestForm } from './export-request-form';

/** Props for {@link ExportDataTab}. */
export interface ExportDataTabProps {
  /** An export linked from email; it is fetched and pinned above the general history. */
  readonly focusedExportId?: string | undefined;
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
    failureTitle: 'Could not start your data export.',
  });

  const focusedPending = Boolean(focusedExportId) && focusedExportQ.isPending;
  if (optionsQ.isPending || exportsQ.isPending || focusedPending) {
    // placeholder: which data categories and workspaces this account can export, plus its export
    // history and the status of any export already running. The whole panel is one form built from
    // those options, so there is no static subset of it that could be shown first.
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (optionsQ.isError || exportsQ.isError) {
    return (
      <LoadFailure
        title="Export data"
        error={optionsQ.error ?? exportsQ.error}
        onRetry={() => {
          void optionsQ.refetch();
          void exportsQ.refetch();
        }}
        retrying={optionsQ.isFetching || exportsQ.isFetching}
      />
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
          <InlineBanner tone="critical" title="Export unavailable">
            This export is no longer available. You can create a new export below.
          </InlineBanner>
        ) : null}
      </div>

      <ExportRequestForm
        options={optionsQ.data}
        hasPendingExport={hasPendingExport}
        creating={requestExport.isPending}
        onCreate={(input) => {
          requestExport.mutate(input);
        }}
      />
      <ExportHistory exports={history} />
    </section>
  );
}
