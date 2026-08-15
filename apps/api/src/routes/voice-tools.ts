/**
 * `@docket/api` — the tools Athena can use while she is still talking.
 *
 * @remarks
 * Deliberately a small, closed surface rather than the whole MCP toolbox, and the reason is the
 * channel rather than the effort: a person on a phone call cannot read a diff, cannot scan a list
 * of forty proposed changes, and cannot un-hear "done". So the voice channel exposes only actions
 * whose entire effect can be *stated in one spoken sentence* and undone by saying so. Anything
 * broader belongs on a surface with a screen, and Athena says as much when asked.
 *
 * Every tool here does the real thing against the real database — there is no voice-only sandbox,
 * because a voice mode that pretends to create tasks is worse than one that refuses to.
 *
 * The summaries are application-owned sentences. They are handed to the realtime model to speak
 * and rendered on the live surface, so they never contain an exception message, a provider string,
 * or an identifier a person would have to read aloud.
 */
import { actor, db, task, team } from '@docket/db';
import { and, asc, desc, eq, ilike, isNull, ne } from 'drizzle-orm';

import { resolveLandingTarget } from '../lib/task-landing';

import type {
  VoiceSessionContext,
  VoiceToolDefinition,
  VoiceToolOutcome,
  VoiceToolRunner,
} from './voice-engine';

/** How many open items a spoken list may name before it stops being listenable. */
const SPOKEN_LIST_LIMIT = 5;

/** The tool declarations handed verbatim to the realtime model. */
export const VOICE_TOOL_DEFINITIONS: readonly VoiceToolDefinition[] = [
  {
    name: 'create_task',
    description:
      'Create a task in the person’s current workspace. Use this the moment they ask for something to be captured — do not wait until the end of your reply.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task title, in the person’s own words.' },
        notes: { type: 'string', description: 'Optional detail they gave out loud.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_open_tasks',
    description:
      'Read back the person’s open tasks. Returns at most five, newest first, because more than that is not listenable.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'complete_task',
    description:
      'Mark an open task done by naming it. Matches on the title the person says; refuses rather than guessing when more than one matches.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Enough of the title to identify it.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
];

/** Read a string argument out of a model-produced call, tolerating its looseness. */
function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The real Docket tool surface for voice.
 *
 * @remarks
 * Stateless; one instance is shared by every session. All scoping comes from the
 * {@link VoiceSessionContext} passed per call, so a session can never act outside the workspace
 * it was started in.
 */
export class DocketVoiceToolRunner implements VoiceToolRunner {
  /** The tools this runner offers. */
  readonly definitions = VOICE_TOOL_DEFINITIONS;

  /**
   * Execute one call and describe what happened in a sentence Athena can say.
   *
   * @param ctx - The session the call belongs to.
   * @param name - Tool name as the model called it.
   * @param args - Call arguments as the model produced them.
   */
  async run(
    ctx: VoiceSessionContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<VoiceToolOutcome> {
    switch (name) {
      case 'create_task':
        return this.createTask(ctx, args);
      case 'list_open_tasks':
        return this.listOpenTasks(ctx);
      case 'complete_task':
        return this.completeTask(ctx, args);
      default:
        // An unknown name is a model error, not a system error. Saying so plainly lets the model
        // recover inside the same turn instead of the person hearing dead air.
        return { ok: false, summary: 'I do not have a way to do that over voice yet.' };
    }
  }

  private async createTask(
    ctx: VoiceSessionContext,
    args: Record<string, unknown>,
  ): Promise<VoiceToolOutcome> {
    const title = stringArg(args, 'title');
    if (!title) return { ok: false, summary: 'I need a name for that task.' };
    if (!ctx.organizationId) {
      return {
        ok: false,
        summary: 'I need to know which workspace this belongs to before I can add it.',
      };
    }
    const landing = await resolveLandingTarget(
      ctx.organizationId,
      ctx.initiatorActorId ?? (await this.resolveActor(ctx)) ?? '',
    );
    if (!landing) {
      return {
        ok: false,
        summary: 'That workspace has no team to file work into yet, so I can’t add it there.',
      };
    }
    const notes = stringArg(args, 'notes');
    const [created] = await db
      .insert(task)
      .values({
        organizationId: ctx.organizationId,
        title,
        ...(notes ? { description: notes } : {}),
        teamId: landing.teamId,
        statusId: landing.statusId,
        state: landing.state,
        assigneeId: landing.assigneeId,
        cycleId: landing.cycleId,
        source: 'native',
        createdBy: ctx.initiatorActorId,
      })
      .returning({ id: task.id });
    if (!created) return { ok: false, summary: 'I couldn’t save that one. Try me again.' };
    return { ok: true, summary: `Added “${title}”.` };
  }

  private async listOpenTasks(ctx: VoiceSessionContext): Promise<VoiceToolOutcome> {
    if (!ctx.organizationId) {
      return { ok: false, summary: 'I need to know which workspace to look in.' };
    }
    const rows = await db
      .select({ title: task.title })
      .from(task)
      .where(
        and(
          eq(task.organizationId, ctx.organizationId),
          isNull(task.completedAt),
          isNull(task.canceledAt),
          isNull(task.archivedAt),
        ),
      )
      .orderBy(desc(task.createdAt))
      .limit(SPOKEN_LIST_LIMIT);
    if (rows.length === 0) return { ok: true, summary: 'Nothing open right now.' };
    return {
      ok: true,
      summary: `${String(rows.length)} open: ${rows.map((r) => r.title).join('; ')}.`,
    };
  }

  private async completeTask(
    ctx: VoiceSessionContext,
    args: Record<string, unknown>,
  ): Promise<VoiceToolOutcome> {
    const query = stringArg(args, 'title');
    if (!query) return { ok: false, summary: 'Which one should I close?' };
    if (!ctx.organizationId) {
      return { ok: false, summary: 'I need to know which workspace to look in.' };
    }
    const matches = await db
      .select({ id: task.id, title: task.title })
      .from(task)
      .where(
        and(
          eq(task.organizationId, ctx.organizationId),
          isNull(task.completedAt),
          isNull(task.canceledAt),
          isNull(task.archivedAt),
          ilike(task.title, `%${query}%`),
        ),
      )
      .orderBy(asc(task.createdAt))
      .limit(2);
    if (matches.length === 0) return { ok: false, summary: `I don’t see an open “${query}”.` };
    if (matches.length > 1) {
      // Refusing beats guessing: closing the wrong task over a phone call is silent and hard to
      // notice, and the person is right there to disambiguate.
      return { ok: false, summary: `More than one matches “${query}”. Which one?` };
    }
    const [match] = matches;
    if (!match) return { ok: false, summary: `I don’t see an open “${query}”.` };
    await db.update(task).set({ completedAt: new Date() }).where(eq(task.id, match.id));
    return { ok: true, summary: `Closed “${match.title}”.` };
  }

  /** Find the person's actor in the session's workspace, for task attribution. */
  private async resolveActor(ctx: VoiceSessionContext): Promise<string | null> {
    if (!ctx.organizationId) return null;
    const rows = await db
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.organizationId, ctx.organizationId),
          eq(actor.userId, ctx.userId),
          ne(actor.kind, 'team'),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }
}

/** Whether a workspace can host voice task creation at all, for the session greeting. */
export async function workspaceHasTeam(organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}
