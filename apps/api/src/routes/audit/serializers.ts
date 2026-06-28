/**
 * Audit route serializers.
 *
 * @packageDocumentation
 */

import type { auditLogs } from '../../db/schema/index.js';

type AuditLogRow = typeof auditLogs.$inferSelect & {
  user?: { id: string; name: string | null; email: string | null } | null;
};

export function toAuditLog(log: AuditLogRow) {
  const changes =
    log.oldValue || log.newValue || log.changedFields
      ? {
          oldValue: log.oldValue,
          newValue: log.newValue,
          changedFields: log.changedFields,
        }
      : null;

  const metadata =
    log.requestId || log.sessionId
      ? {
          requestId: log.requestId,
          sessionId: log.sessionId,
        }
      : null;

  return {
    id: log.id,
    userId: log.userId,
    action: log.action as 'create' | 'update' | 'delete',
    entityType: log.entityType,
    entityId: log.entityId,
    changes,
    metadata,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt,
  };
}
