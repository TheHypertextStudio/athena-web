/**
 * `@docket/api` — the retrospective read: what a day actually was.
 *
 * @remarks
 * The counterpart to `brief`, which only ever looks forward. Asked "what did I get done today", an
 * agent previously had no way to answer except by listing tasks that happen to be marked complete —
 * which misses everything that happened in mail, in meetings, and in tools Docket does not own.
 *
 * Delegates entirely to {@link readActivityDay}, the same entry point the HTTP route uses, so
 * the assistant and the app can never drift into two answers to the same question. Hub-scoped and
 * deliberately cross-organization: a day does not respect org boundaries.
 *
 * Curation stays out of the agent's reach. Rewriting the sentence about one's own work is a human
 * editing gesture, and handing an agent a write path to prose it authored is a loop nobody asked for.
 */
import { z } from 'zod';

import { NotFoundError } from '../error';
import { readActivityDay } from '../services/highlights/read';

import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonResult, runTool } from './result';

/** Register `retrospect` on `server`. */
export function registerRetrospectTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'retrospect',
    {
      title: 'Retrospect',
      description:
        'What a person actually did on a given day, gathered from every tool they have connected and grouped so that a run of work on one thing reads as one entry. Spans every organization they belong to. Each entry carries where it came from, when it happened, and a sentence describing it. Use this when asked what got done, what a day looked like, or to write a summary of work already completed — `brief` answers the opposite question, what is still waiting.',
      inputSchema: {
        date: z.iso
          .date()
          .optional()
          .describe(
            "The day to look back on, as `YYYY-MM-DD`. Omit for the caller's current local day. Ask rather than guessing at a date.",
          ),
      },
      outputSchema: {
        date: z.string(),
        timezone: z.string().describe('The zone the day was measured in.'),
        status: z
          .string()
          .describe(
            'How complete the day is: `pending` (not gathered yet), `empty` (gathered, nothing happened), `ready`, or `failed`.',
          ),
        eventCount: z.number().int().describe('How many separate things the day was built from.'),
        highlights: z
          .array(z.unknown())
          .describe('One entry per thing worked on, with its description and where it came from.'),
        sources: z
          .array(z.unknown())
          .describe(
            'How each connected tool fared. A day where a tool could not be read is incomplete rather than quiet — say so instead of implying nothing happened.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // An org-registered agent has no Hub and therefore no day of its own. Reported as not-found
        // rather than forbidden, because from the agent's side the thing genuinely does not exist —
        // the same choice `brief` makes.
        if (ctx.principal.kind === 'agent') throw new NotFoundError('Hub not found');
        return jsonResult(await readActivityDay(ctx.principal.userId, input.date, new Date()));
      }),
  );
}
