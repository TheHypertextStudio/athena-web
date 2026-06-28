/**
 * Attachment route serializers.
 *
 * @packageDocumentation
 */

import type { attachments } from '../../db/schema/index.js';

type AttachmentRow = typeof attachments.$inferSelect;

function isAttachmentEntityType(value: string | null): value is 'task' | 'project' | 'event' {
  return value === 'task' || value === 'project' || value === 'event';
}

export function toAttachment(attachment: AttachmentRow) {
  const entityType = isAttachmentEntityType(attachment.entityType)
    ? attachment.entityType
    : null;

  return {
    id: attachment.id,
    userId: attachment.userId,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    entityType,
    entityId: entityType ? attachment.entityId : null,
    isPublic: Boolean(attachment.publicUrl),
    url: attachment.publicUrl ?? null,
    createdAt: attachment.createdAt,
  };
}
