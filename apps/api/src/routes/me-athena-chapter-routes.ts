/** Owner-only chapter routes for the canonical personal conversation. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { created as createdResponse, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import {
  AthenaChapterEnd,
  AthenaChapterOut,
  AthenaChapterStart,
  AthenaChaptersOut,
  deleteAthenaChapter,
  endAthenaChapter,
  listAthenaChapters,
  startAthenaChapter,
} from './me-athena-chapters';

/** The authenticated owner comes only from the request session. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/** Mount chapter reads and writes below `/chat/chapters`. */
export function athenaChapterRoutes(chatId: (ownerUserId: string) => Promise<string>) {
  return new Hono<AppEnv>()
    .get(
      '/',
      apiDoc({
        tag: 'Athena',
        summary: 'List marked conversation sections',
        response: AthenaChaptersOut,
        description: 'Return the caller’s marked sections in the current Athena conversation.',
      }),
      async (c) => {
        const owner = requestOwner(c);
        return ok(c, AthenaChaptersOut, await listAthenaChapters(owner, await chatId(owner)));
      },
    )
    .post(
      '/',
      apiDoc({
        status: 201,
        tag: 'Athena',
        summary: 'Mark the start of a conversation section',
        response: AthenaChapterOut,
        description:
          'Start one owner-only section at a visible message in the current conversation.',
      }),
      zJson(AthenaChapterStart),
      async (c) => {
        const owner = requestOwner(c);
        return createdResponse(
          c,
          AthenaChapterOut,
          await startAthenaChapter(owner, await chatId(owner), c.req.valid('json')),
        );
      },
    )
    .put(
      '/:chapterId',
      apiDoc({
        tag: 'Athena',
        summary: 'Mark the end of a conversation section',
        response: AthenaChapterOut,
        description: 'Close the caller’s open section at a message that follows its start.',
      }),
      zParam(z.object({ chapterId: z.string() })),
      zJson(AthenaChapterEnd),
      async (c) => {
        const owner = requestOwner(c);
        return ok(
          c,
          AthenaChapterOut,
          await endAthenaChapter(
            owner,
            await chatId(owner),
            c.req.valid('param').chapterId,
            c.req.valid('json').endActivityId,
          ),
        );
      },
    )
    .delete(
      '/:chapterId',
      apiDoc({
        tag: 'Athena',
        summary: 'Remove a conversation section',
        response: z.object({ deleted: z.boolean() }),
        description: 'Remove the caller’s section markers without deleting conversation activity.',
      }),
      zParam(z.object({ chapterId: z.string() })),
      async (c) => {
        const owner = requestOwner(c);
        return ok(
          c,
          z.object({ deleted: z.boolean() }),
          await deleteAthenaChapter(owner, await chatId(owner), c.req.valid('param').chapterId),
        );
      },
    );
}
