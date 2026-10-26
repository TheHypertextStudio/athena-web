'use client';

import type { WorkResourceSubjectType } from '@docket/work/attachment-contract';
import type { JSX } from 'react';
import type { EntityMentionsData } from '@/lib/use-entity-mentions';
import { useWorkResources } from '@/lib/use-work-resources';
import { ResourcesTab } from './resources-tab';

/** One destination's attached material and existing prose references. */
export interface WorkResourcesPanelProps {
  readonly orgId: string;
  readonly subjectType: WorkResourceSubjectType;
  readonly subjectId: string;
  readonly canEdit: boolean;
  readonly description: string | null | undefined;
  readonly mentions: EntityMentionsData;
}

/** Give every work type the same usable upload, download, removal, loading and error behavior. */
export function WorkResourcesPanel({
  orgId,
  subjectType,
  subjectId,
  canEdit,
  description,
  mentions,
}: WorkResourcesPanelProps): JSX.Element {
  const data = useWorkResources(orgId, subjectType, subjectId);
  return (
    <ResourcesTab
      resources={data.resources}
      loading={data.loading}
      canEdit={canEdit}
      pending={data.pending}
      error={data.error}
      loadFailure={data.loadFailure}
      onAdd={data.add}
      onRemove={data.remove}
      onUpload={data.upload}
      uploading={data.uploading}
      downloadHref={data.downloadHref}
      onRetry={data.retry}
      {...(subjectType === 'program'
        ? {}
        : { subject: { type: subjectType, id: subjectId, organizationId: orgId } })}
      mentionedExternal={mentions.external}
      mentionedEntities={mentions.entities}
      mentionsPending={mentions.isPending}
      hasProse={(description ?? '').trim().length > 0}
    />
  );
}
