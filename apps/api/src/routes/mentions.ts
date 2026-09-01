/**
 * `@docket/api` — the `@` picker and the previews its chips render.
 *
 * @remarks
 * The picker is split across two routes on purpose. `/search` answers from the local index and
 * nothing else, so it returns in single-digit milliseconds and can never be delayed by a
 * third-party outage. `/external` fans out to the caller's connected apps under a deadline. The
 * client fires both in parallel and merges, which is what lets results stream in without the list
 * ever going blank.
 *
 * Reads only, so org membership via `orgContextMiddleware` is the whole gate — the same bar
 * `/search` sets, since a mention picker shows nothing the search box would not.
 */
import {
  MentionExternalOut,
  MentionHydrateIn,
  MentionHydrateOut,
  MentionSearchOut,
} from '../contracts/mention';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { searchExternalMentions } from '../content/mention-external';
import { hydrateMentions } from '../content/mention-hydrate';
import { searchLocalMentions } from '../content/mention-search';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zQuery } from '../lib/validate';

/** Query parameters accepted by the local picker wave. */
const MentionSearchQuery = z.object({
  q: z
    .string()
    .max(128)
    .default('')
    .describe(
      'What the user has typed after the `@`. Empty is meaningful and common: it asks for recents, which is what the picker shows the instant `@` is pressed.',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe(
      'How many rows to return. The picker asks for few, because a long menu is a slow menu.',
    ),
});

const mentions = new Hono<AppEnv>()
  .get(
    '/search',
    apiDoc({
      tag: 'Mentions',
      summary: 'Search mentionable entities in this organization',
      response: MentionSearchOut,
      description:
        "Return Docket entities the caller can reference from prose, answered from the local search index with no external provider call. An empty query returns the caller's most recently updated visible entities, which is what the picker shows before anything is typed.",
    }),
    zQuery(MentionSearchQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const { q, limit } = c.req.valid('query');

      const items = await searchLocalMentions({
        caller: { kind: 'user', userId: session.user.id },
        orgId,
        query: q,
        limit,
      });
      return ok(c, MentionSearchOut, { query: q.trim(), items });
    },
  )
  .get(
    '/external',
    apiDoc({
      tag: 'Mentions',
      summary: "Search resources in the caller's connected apps",
      response: MentionExternalOut,
      description:
        "Fan out to the apps this caller has connected, under a per-provider deadline. Always returns 200 when the request itself is valid: a provider that is slow, throttled, or needs reauthorization is reported in `providers` as a closed status code, so one degraded app never removes another app's results or empties a menu the user is reading.",
    }),
    zQuery(MentionSearchQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId, actorId } = c.get('actorCtx');
      const { q, limit } = c.req.valid('query');

      const result = await searchExternalMentions({ actorId, orgId, query: q, limit });
      return ok(c, MentionExternalOut, {
        query: q.trim(),
        items: result.items,
        providers: result.providers,
      });
    },
  )
  .post(
    '/hydrate',
    apiDoc({
      tag: 'Mentions',
      summary: 'Resolve references into preview cards',
      response: MentionHydrateOut,
      description:
        "Resolve a batch of references into the cards their chips render on hover. POST rather than GET because references are user content that has no business in a URL, and because a document's worth of them exceeds any safe query-string length. Entities the caller cannot see come back marked inaccessible and carry no other fields.",
    }),
    zJson(MentionHydrateIn),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const { refs } = c.req.valid('json');

      const items = await hydrateMentions({
        caller: { kind: 'user', userId: session.user.id },
        orgId,
        refs,
      });
      return ok(c, MentionHydrateOut, { items });
    },
  );

export default mentions;
