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
        summary: 'List saved conversation places',
        response: AthenaChaptersOut,
        description: 'Return the caller’s named places in the current Athena conversation.',
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
        summary: 'Save a starting point in the conversation',
        response: AthenaChapterOut,
        description:
          'Save one owner-only named place at a visible message in the current conversation.',
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
        summary: 'Mark where a saved place finishes',
        response: AthenaChapterOut,
        description: 'Finish the caller’s open saved place at a later message.',
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
        summary: 'Remove a saved conversation place',
        response: z.object({ deleted: z.boolean() }),
        description: 'Remove the caller’s saved markers without deleting conversation activity.',
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
