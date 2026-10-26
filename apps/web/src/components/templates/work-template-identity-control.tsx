'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateChoice,
  WorkTemplateDisplay,
  WorkTemplateChangeRequest,
  WorkTemplateChangeField,
} from '@docket/work/work-template-reference';
import { Button } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useState } from 'react';
import { UserFacingError } from '@/lib/problem';
import { useApiQuery } from '@/lib/query';
import { workTargetCollectionKey } from '@/lib/query-keys';
import {
  WorkTemplateChoiceMenu,
  WorkTemplateIdentityLabel,
  type WorkTemplatePresentationProps,
} from './work-template-choice-menu';
import { WorkTemplateChangePreview } from './work-template-change-preview';
import {
  useWorkTemplateAssignment,
  workTemplateIdentityDef,
  workTemplateChangePreviewDef,
} from './work-template-identity-queries';

/** One work item's immutable published identity and resource-authorized change action. */
export interface WorkTemplateIdentityControlProps extends WorkTemplatePresentationProps {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly workId: string;
  readonly teamId?: string | null;
  readonly workTypeId?: string | undefined;
  readonly workTypeVersionId?: string | undefined;
  readonly canEdit: boolean;
  readonly onCapture?: (() => void) | undefined;
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
  onCapture,
  presentation,
  menuLabel,
  menuItems,
}: WorkTemplateIdentityControlProps): JSX.Element {
  const familyName = useVocabulary(kind);
  const change = useTemplateChangeController(orgId, kind, workId, workTypeId);
  const queryClient = useQueryClient();
  const identity = useApiQuery(workTemplateIdentityDef(orgId, workTypeId, workTypeVersionId));
  const current = identity.data;
  const retry = (): void => {
    if (workTypeId && workTypeVersionId) void identity.refetch();
    else
      void queryClient.invalidateQueries({
        queryKey: [...workTargetCollectionKey(orgId, kind), workId],
      });
  };
  if (!current && presentation !== 'menu')
    return (
      <>
        <TemplateIdentityRetry
          loading={identity.isPending && Boolean(workTypeId)}
          onRetry={retry}
        />
        {onCapture ? (
          <Button variant="ghost" size="sm" onClick={onCapture}>
            Save as template
          </Button>
        ) : null}
      </>
    );
  return (
    <>
      {canEdit || onCapture || presentation === 'menu' ? (
        <WorkTemplateChoiceMenu
          orgId={orgId}
          kind={kind}
          teamId={teamId}
          current={current}
          presentation={presentation}
          menuLabel={menuLabel}
          menuItems={menuItems}
          loading={identity.isPending && Boolean(workTypeId)}
          onRetry={retry}
          versionId={workTypeVersionId}
          onSelect={change.select}
          canChange={canEdit && Boolean(current)}
          onCapture={onCapture}
          onUpdate={templateUpdateAction(current, canEdit, workTypeVersionId, change.select)}
        />
      ) : current ? (
        <span className="text-label-medium inline-flex max-w-full min-w-0 items-center gap-1.5">
          <WorkTemplateIdentityLabel kind={kind} current={current} />
        </span>
      ) : null}
      <WorkTemplateChangePreview
        key={change.previewKey}
        {...change.previewProps}
        workTypeContext={presentation === 'menu'}
        familyName={familyName}
      />
    </>
  );
}

/** Offer a deliberate update only when the pinned identity has a newer live publication. */
function templateUpdateAction(
  current: WorkTemplateDisplay | undefined,
  canEdit: boolean,
  versionId: string | undefined,
  select: (choice: WorkTemplateDisplay) => void,
): (() => void) | undefined {
  if (
    !current ||
    !canEdit ||
    current.archived ||
    current.latestVersionNumber <= current.versionNumber ||
    !versionId
  )
    return undefined;
  return () => {
    select({ ...current, versionNumber: current.latestVersionNumber });
  };
}

function useTemplateChangeController(
  orgId: string,
  kind: TemplateTargetType,
  workId: string,
  currentTypeId: string | undefined,
) {
  const [selected, setSelected] = useState<WorkTemplateChoice | WorkTemplateDisplay | null>(null);
  const mutation = useWorkTemplateAssignment(orgId, kind, workId);
  const selection: WorkTemplateChangeRequest | null = selected
    ? {
        workTypeId: selected.id,
        ...(selected.id === currentTypeId
          ? { mode: 'update' as const }
          : { workTypeVersionId: 'versionId' in selected ? selected.versionId : undefined }),
      }
    : null;
  const preview = useApiQuery(workTemplateChangePreviewDef(orgId, kind, workId, selection));
  const close = (): void => {
    setSelected(null);
  };
  return {
    select: (choice: WorkTemplateChoice | WorkTemplateDisplay): void => {
      mutation.reset();
      setSelected(choice);
    },
    previewKey: `${selected?.id ?? ''}:${selection?.mode ?? 'change'}`,
    previewProps: {
      selected,
      preview: preview.data,
      loading: preview.isPending || preview.isFetching,
      previewFailed: preview.isError,
      pending: mutation.isPending,
      failed: mutation.isError,
      stale: mutation.error instanceof UserFacingError && mutation.error.status === 409,
      mode: selection?.mode ?? 'change',
      onRetryPreview: (): void => {
        mutation.reset();
        void preview.refetch();
      },
      onClose: close,
      onConfirm: (applyFields: WorkTemplateChangeField[], acceptChildChanges: string[]): void => {
        if (!selected || !preview.data || preview.isError) return;
        mutation.mutate(
          {
            workTypeId: selected.id,
            workTypeVersionId: preview.data.workTypeVersionId,
            previewToken: preview.data.previewToken,
            applyFields,
            ...(selection?.mode === 'update' ? { mode: 'update' as const } : {}),
            ...(acceptChildChanges.length ? { acceptChildChanges } : {}),
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
