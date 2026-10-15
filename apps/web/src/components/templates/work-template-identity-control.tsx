'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateChoice,
  WorkTemplateChangeRequest,
  WorkTemplateChangeField,
} from '@docket/work/work-template-reference';
import { Button } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useState } from 'react';
import { useApiQuery } from '@/lib/query';
import { workTargetCollectionKey } from '@/lib/query-keys';
import { WorkTemplateChoiceMenu, WorkTemplateIdentityLabel } from './work-template-choice-menu';
import { WorkTemplateChangePreview } from './work-template-change-preview';
import {
  useWorkTemplateAssignment,
  workTemplateIdentityDef,
  workTemplateChangePreviewDef,
} from './work-template-identity-queries';

/** One work item's immutable published identity and resource-authorized change action. */
export interface WorkTemplateIdentityControlProps {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly workId: string;
  readonly teamId?: string | null;
  readonly workTypeId?: string | undefined;
  readonly workTypeVersionId?: string | undefined;
  readonly canEdit: boolean;
}

/** Show the pinned version and preview explicit starting changes while preserving work by default. */
export function WorkTemplateIdentityControl({
  orgId,
  kind,
  workId,
  teamId = null,
  workTypeId,
  workTypeVersionId,
  canEdit,
}: WorkTemplateIdentityControlProps): JSX.Element {
  const change = useTemplateChangeController(orgId, kind, workId);
  const queryClient = useQueryClient();
  const identity = useApiQuery(workTemplateIdentityDef(orgId, workTypeId, workTypeVersionId));
  const current = identity.data;
  if (!current)
    return (
      <TemplateIdentityRetry
        loading={identity.isPending && Boolean(workTypeId)}
        onRetry={() => {
          if (workTypeId && workTypeVersionId) void identity.refetch();
          else
            void queryClient.invalidateQueries({
              queryKey: [...workTargetCollectionKey(orgId, kind), workId],
            });
        }}
      />
    );
  return (
    <>
      {canEdit ? (
        <WorkTemplateChoiceMenu
          orgId={orgId}
          kind={kind}
          teamId={teamId}
          current={current}
          versionId={workTypeVersionId}
          onSelect={change.select}
        />
      ) : (
        <span className="text-label-medium inline-flex max-w-full min-w-0 items-center gap-1.5">
          <WorkTemplateIdentityLabel kind={kind} current={current} />
        </span>
      )}
      <WorkTemplateChangePreview key={change.previewKey} {...change.previewProps} />
    </>
  );
}

function useTemplateChangeController(orgId: string, kind: TemplateTargetType, workId: string) {
  const [selected, setSelected] = useState<WorkTemplateChoice | null>(null);
  const mutation = useWorkTemplateAssignment(orgId, kind, workId);
  const selection: WorkTemplateChangeRequest | null = selected
    ? { workTypeId: selected.id, workTypeVersionId: selected.versionId }
    : null;
  const preview = useApiQuery(workTemplateChangePreviewDef(orgId, kind, workId, selection));
  const close = (): void => {
    setSelected(null);
  };
  return {
    select: (choice: WorkTemplateChoice): void => {
      mutation.reset();
      setSelected(choice);
    },
    previewKey: `${selected?.id ?? ''}:${preview.data?.previewToken ?? ''}`,
    previewProps: {
      selected,
      preview: preview.data,
      loading: preview.isPending || preview.isFetching,
      previewFailed: preview.isError,
      pending: mutation.isPending,
      failed: mutation.isError,
      onRetryPreview: (): void => {
        mutation.reset();
        void preview.refetch();
      },
      onClose: close,
      onConfirm: (applyFields: WorkTemplateChangeField[]): void => {
        if (!selected || !preview.data || preview.isError) return;
        mutation.mutate(
          {
            workTypeId: selected.id,
            workTypeVersionId: preview.data.workTypeVersionId,
            previewToken: preview.data.previewToken,
            applyFields,
          },
          { onSuccess: close },
        );
      },
    },
  };
}

function TemplateIdentityRetry({
  loading,
  onRetry,
}: {
  readonly loading: boolean;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
      {loading ? 'Loading template…' : 'Template unavailable · Retry'}
    </Button>
  );
}
