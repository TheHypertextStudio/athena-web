/** Durable replay keys for MCP authored-content tools. */
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** One atomically committed comment or update identified by a caller-reused MCP request id. */
export const mcpContentReceipt = pgTable(
  'mcp_content_receipt',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    callerKey: text('caller_key').notNull(),
    toolName: text('tool_name').notNull(),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    postId: text('post_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mcp_content_receipt_request_uq').on(
      t.organizationId,
      t.callerKey,
      t.toolName,
      t.requestId,
    ),
    index('mcp_content_receipt_expiry_idx').on(t.expiresAt, t.id),
  ],
);
