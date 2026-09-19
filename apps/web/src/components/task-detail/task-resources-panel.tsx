'use client';

/**
 * The task's Resources tab: attached links and files, plus what the description points at.
 *
 * @remarks
 * Mounted only while the tab is showing, so the attachment list is not read until someone opens
 * it. The derived references arrive as props because the page already gates that read on the tab.
 */
import type { JSX } from 'react';

import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import type { EntityMentionsData } from '@/lib/use-entity-mentions';
import { useTaskAttachments } from '@/lib/use-attachments';

/** Props for {@link TaskResourcesPanel}. */
export interface TaskResourcesPanelProps {
  readonly orgId: string;
  readonly taskId: string;
  readonly canEdit: boolean;
  /** The task's description, which decides whether derived references can exist. */
  readonly description: string | null | undefined;
  /** What the description points at, derived on the server. */
  readonly mentions: EntityMentionsData;
}

/**
 * Render the Resources tab's content.
 *
 * @param props - See {@link TaskResourcesPanelProps}.
 * @returns the resource list with its add and upload controls.
 */
export function TaskResourcesPanel({
  orgId,
  taskId,
  canEdit,
  description,
  mentions,
}: TaskResourcesPanelProps): JSX.Element {
  const { attachments, addUrl, addFile, remove, downloadUrl, isUploading, actionError } =
    useTaskAttachments(orgId, taskId);
  return (
    <ResourcesTab
      resources={attachments}
      canEdit={canEdit}
      pending={isUploading}
      error={actionError}
      onAdd={(resource) => {
        void addUrl(resource);
      }}
      onRemove={(resourceId) => {
        void remove(resourceId);
      }}
      onUpload={(file) => {
        void addFile({ file });
      }}
      uploading={isUploading}
      downloadHref={downloadUrl}
      mentionedExternal={mentions.external}
      mentionedEntities={mentions.entities}
      mentionsPending={mentions.isPending}
      hasProse={(description ?? '').trim().length > 0}
    />
  );
}
