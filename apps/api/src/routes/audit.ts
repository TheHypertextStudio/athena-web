/**
 * Audit log routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getWebhookService } from '../services/webhooks/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const app = new Hono();

app.use('*', requireAuth);

const PAGINATION_LIMIT_MIN = 1;
const PAGINATION_LIMIT_MAX = 100;
const PAGINATION_OFFSET_MIN = 0;
const AUDIT_ACTION_VALUES = ['create', 'update', 'delete'] as const;

/**
 * GET /audit
 * Get audit logs for the user.
 */
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      entityType: z.string().optional(),
      entityId: z.uuid().optional(),
      action: z.enum(AUDIT_ACTION_VALUES).optional(),
      limit: z.coerce.number().min(PAGINATION_LIMIT_MIN).max(PAGINATION_LIMIT_MAX).optional(),
      offset: z.coerce.number().min(PAGINATION_OFFSET_MIN).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const params = c.req.valid('query');

    const service = getWebhookService();
    const logs = await service.getAuditLogs({
      userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      limit: params.limit,
      offset: params.offset,
    });

    return c.json({
      success: true,
      data: logs,
    });
  },
);

/**
 * GET /audit/entity/:type/:id
 * Get audit logs for a specific entity.
 */
app.get(
  '/entity/:type/:id',
  zValidator(
    'query',
    z.object({
      limit: z.coerce.number().min(PAGINATION_LIMIT_MIN).max(PAGINATION_LIMIT_MAX).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const entityType = c.req.param('type');
    const entityId = c.req.param('id');
    const { limit } = c.req.valid('query');

    const service = getWebhookService();
    const logs = await service.getAuditLogs({
      userId,
      entityType,
      entityId,
      limit,
    });

    return c.json({
      success: true,
      data: logs,
    });
  },
);

export default app;
