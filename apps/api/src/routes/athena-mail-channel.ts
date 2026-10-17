import { readMailAttachment } from '../services/athena-mail/attachments';
import { zParam } from '../lib/validate';
import { z } from 'zod';
/** Authenticated native mail setup and delivery visibility. */
import { athenaMailOutbox, db } from '@docket/db';
import {
  AthenaMailChannelOut,
  AthenaMailChannelUpdate,
  AthenaMailOutboxOut,
} from '@docket/athena/athena-mail-contract';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { apiDoc } from '../lib/openapi-route';
import { ok } from '../lib/ok';
import { zJson } from '../lib/validate';
import { pageOf } from '../contracts/pagination';
import { requestUserId } from './agent-session-helpers';
import { configureMailChannel, readMailChannel } from '../services/athena-mail/channel';
import { mailOutboxView } from '../services/athena-mail/outbox';
/** Owner-only channel routes; setup cannot be performed through an email or MCP instruction. */
export const athenaMailChannel = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Athena',
      summary: 'Get native email channel settings',
      response: AthenaMailChannelOut,
    }),
    async (c) => ok(c, AthenaMailChannelOut, await readMailChannel(requestUserId(c))),
  )
  .put(
    '/',
    apiDoc({
      tag: 'Athena',
      summary: 'Configure native owner email channel',
      response: AthenaMailChannelOut,
    }),
    zJson(AthenaMailChannelUpdate),
    async (c) =>
      ok(
        c,
        AthenaMailChannelOut,
        await configureMailChannel(requestUserId(c), c.req.valid('json')),
      ),
  )
  .get(
    '/attachments/:messageId/:attachmentId',
    apiDoc({
      tag: 'Athena',
      summary: 'Download a private received email attachment',
      description:
        'Streams validated inert text as an owner-only download. Current channel consent is required. Bytes are never rendered inline or exposed through a public storage URL.',
      extra: {
        responses: {
          200: {
            description: 'Private validated file bytes, downloaded rather than rendered inline.',
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
    }),
    zParam(z.object({ messageId: z.string().min(1), attachmentId: z.string().min(1) })),
    async (c) => {
      const { messageId, attachmentId } = c.req.valid('param');
      const file = await readMailAttachment(requestUserId(c), messageId, attachmentId);
      c.header('Content-Type', 'application/octet-stream');
      c.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Cache-Control', 'private, no-store');
      return c.body(Buffer.from(file.bytes));
    },
  )
  .get(
    '/outbox',
    apiDoc({
      tag: 'Athena',
      summary: 'List native email delivery outcomes',
      response: pageOf(AthenaMailOutboxOut),
    }),
    async (c) => {
      const rows = await db
        .select()
        .from(athenaMailOutbox)
        .where(eq(athenaMailOutbox.ownerUserId, requestUserId(c)))
        .orderBy(desc(athenaMailOutbox.createdAt))
        .limit(50);
      return ok(c, pageOf(AthenaMailOutboxOut), { items: rows.map(mailOutboxView) });
    },
  );
