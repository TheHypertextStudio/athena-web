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
import { canActor } from '@docket/authz';
import { db, task, team } from '@docket/db';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';

import { encodeListCursor, seekAfter } from '../lib/list-cursor';
import { resolveLandingTarget } from '../lib/task-landing';
import { setTaskState } from '../lib/task-state';
import { loadStatusSets } from '../lib/work-status';

import { buildTaskViewFilter } from './task-helpers';
import type {
  VoiceSessionContext,
  VoiceToolDefinition,
  VoiceToolOutcome,
  VoiceToolRunner,
} from './voice-engine';

/** How many open items a spoken list may name before it stops being listenable. */
const SPOKEN_LIST_LIMIT = 5;

/** A raw query batch while filtering task visibility in-memory. */
const TASK_SCAN_BATCH_SIZE = 100;

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
    const actorId = ctx.initiatorActorId;
    if (!actorId) return unavailableActorOutcome();
    const landing = await resolveLandingTarget(ctx.organizationId, actorId);
    if (!landing) {
      return {
        ok: false,
        summary: 'That workspace has no team to file work into yet, so I can’t add it there.',
      };
    }
    const contribution = await canActor(
      actorId,
      'contribute',
      { kind: 'team', id: landing.teamId, orgId: ctx.organizationId },
      db,
    );
    if (!contribution.allow) {
      return {
        ok: false,
        summary: 'I can’t add a task in that workspace with your current access.',
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
        createdBy: actorId,
      })
      .returning({ id: task.id });
    if (!created) return { ok: false, summary: 'I couldn’t save that one. Try me again.' };
    return { ok: true, summary: `Added “${title}”.` };
  }

  private async listOpenTasks(ctx: VoiceSessionContext): Promise<VoiceToolOutcome> {
    if (!ctx.organizationId) {
      return { ok: false, summary: 'I need to know which workspace to look in.' };
    }
    const actorId = ctx.initiatorActorId;
    if (!actorId) return unavailableActorOutcome();
    const canView = await buildTaskViewFilter(ctx.organizationId, actorId);
    const visible: { id: string; title: string; createdAt: Date }[] = [];
    let after: string | undefined;

    // View access is a data-backed predicate so it cannot be safely pushed into this SQL query.
    // Keep keyset-scanning until the spoken limit is filled: a run of private rows must not hide a
    // later task the caller is actually allowed to hear.
    while (visible.length < SPOKEN_LIST_LIMIT) {
      const rows = await db
        .select({
          id: task.id,
          title: task.title,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
          createdAt: task.createdAt,
        })
        .from(task)
        .where(
          and(
            eq(task.organizationId, ctx.organizationId),
            isNull(task.completedAt),
            isNull(task.canceledAt),
            isNull(task.archivedAt),
            seekAfter(task.createdAt, task.id, after),
          ),
        )
        .orderBy(desc(task.createdAt), desc(task.id))
        .limit(TASK_SCAN_BATCH_SIZE);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (!canView(row)) continue;
        visible.push({ id: row.id, title: row.title, createdAt: row.createdAt });
        if (visible.length === SPOKEN_LIST_LIMIT) break;
      }
      if (visible.length === SPOKEN_LIST_LIMIT || rows.length < TASK_SCAN_BATCH_SIZE) break;
      const last = rows[rows.length - 1];
      /* v8 ignore next -- @preserve non-empty batch above guarantees a last row */
      if (!last) break;
      after = encodeListCursor(last.createdAt, last.id);
    }

    if (visible.length === 0) return { ok: true, summary: 'Nothing open right now.' };
    return {
      ok: true,
      summary: `${String(visible.length)} open: ${visible.map((r) => r.title).join('; ')}.`,
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
    const actorId = ctx.initiatorActorId;
    if (!actorId) return unavailableActorOutcome();
    const canView = await buildTaskViewFilter(ctx.organizationId, actorId);
    const matches: {
      id: string;
      title: string;
      teamId: string;
      projectId: string | null;
      programId: string | null;
      visibility: 'public' | 'private';
      createdAt: Date;
    }[] = [];
    let after: string | undefined;

    // As with the spoken list, scan past hidden matches before deciding whether the caller named
    // zero, one, or several tasks. A private row cannot make a visible exact match disappear or
    // turn it into a false ambiguity.
    while (matches.length <= 1) {
      const rows = await db
        .select({
          id: task.id,
          title: task.title,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
          createdAt: task.createdAt,
        })
        .from(task)
        .where(
          and(
            eq(task.organizationId, ctx.organizationId),
            isNull(task.completedAt),
            isNull(task.canceledAt),
            isNull(task.archivedAt),
            ilike(task.title, `%${query}%`),
            seekAfter(task.createdAt, task.id, after),
          ),
        )
        .orderBy(desc(task.createdAt), desc(task.id))
        .limit(TASK_SCAN_BATCH_SIZE);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (!canView(row)) continue;
        matches.push(row);
        if (matches.length > 1) break;
      }
      if (matches.length > 1 || rows.length < TASK_SCAN_BATCH_SIZE) break;
      const last = rows[rows.length - 1];
      /* v8 ignore next -- @preserve non-empty batch above guarantees a last row */
      if (!last) break;
      after = encodeListCursor(last.createdAt, last.id);
    }

    if (matches.length === 0) return { ok: false, summary: `I don’t see an open “${query}”.` };
    if (matches.length > 1) {
      // Refusing beats guessing: closing the wrong task over a phone call is silent and hard to
      // notice, and the person is right there to disambiguate.
      return { ok: false, summary: `More than one matches “${query}”. Which one?` };
    }
    const [match] = matches;
    if (!match) return { ok: false, summary: `I don’t see an open “${query}”.` };
    const contribution = await canActor(
      actorId,
      'contribute',
      { kind: 'task', id: match.id, orgId: ctx.organizationId },
      db,
    );
    if (!contribution.allow) {
      return {
        ok: false,
        summary: 'I can see that task, but I don’t have permission to close it.',
      };
    }
    const statuses = await loadStatusSets(ctx.organizationId, {
      entityTypes: ['task'],
      teamIds: [match.teamId],
    });
    const completedStatus = statuses
      .for('task', match.teamId)
      .find((status) => status.category === 'completed');
    if (!completedStatus) return { ok: false, summary: 'I cannot close tasks in this workspace.' };
    const completed = await setTaskState({
      organizationId: ctx.organizationId,
      taskId: match.id,
      state: completedStatus.key,
      actorId,
    });
    if (!completed) return { ok: false, summary: 'I could not close that task.' };
    return { ok: true, summary: `Closed “${match.title}”.` };
  }
}

/** Keep an unbound or stale session from saying anything about a workspace it cannot authorize. */
function unavailableActorOutcome(): VoiceToolOutcome {
  return {
    ok: false,
    summary: 'I can’t verify your workspace access for that right now.',
  };
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
