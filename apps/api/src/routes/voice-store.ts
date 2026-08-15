/**
 * `@docket/api` — writing spoken turns into the one Athena conversation.
 *
 * @remarks
 * This adapter is the reason a phone call and a browser chat are the *same* conversation rather
 * than two records that a reporting view later staples together. A spoken turn is written to
 * exactly the places a typed turn is written:
 *
 * 1. `session_activity` on the canonical `agent_session`, so it appears in the visible timeline
 *    in order, interleaved with typed messages;
 * 2. `agent_session_transcript`, the durable `TurnMessage[]` the text agent loop resumes from, so
 *    something said out loud on Tuesday is context Athena has when you type on Wednesday.
 *
 * There is deliberately **no** voice transcript table. A "call log" that holds the only copy of
 * what was said is the failure mode this design exists to prevent — so the copy does not exist to
 * be the only one.
 *
 * The one thing a spoken turn carries that a typed one does not is `body.voice`: the channel it
 * arrived on and whether it was cut short. That is a marker on the shared row, not a separate
 * lane.
 */
import { db, sessionActivity, voiceSession } from '@docket/db';
import type { TurnMessage } from '@docket/athena/turn-protocol';
import type { VoiceActionOut, VoiceEndReason, VoiceTurnOut } from '@docket/athena/voice';
import { eq, sql } from 'drizzle-orm';

import { loadTranscript, saveTranscript } from '../agent/transcript';

import type { VoiceSessionContext, VoiceToolOutcome, VoiceTranscriptStore } from './voice-engine';

/** The channel marker written onto every spoken `session_activity` row. */
export interface VoiceActivityMarker {
  /** Which transport the turn arrived on. */
  readonly channel: 'web' | 'phone';
  /** The `voice_session` row, so a support question about one call is answerable. */
  readonly voiceSessionId: string;
  /** True when the person spoke over Athena and this is only what they heard. */
  readonly interrupted: boolean;
}

/**
 * The database-backed transcript store.
 *
 * @remarks
 * Every write is one transaction covering both the visible activity row and the resumable
 * transcript, exactly as the text loop does, so the two can never disagree about what was said.
 */
export class DatabaseVoiceTranscriptStore implements VoiceTranscriptStore {
  /** Append what the person said. */
  async appendUserTurn(ctx: VoiceSessionContext, text: string): Promise<VoiceTurnOut> {
    const row = await this.append(ctx, 'user', text, false);
    await db
      .update(voiceSession)
      .set({ userTurns: sql`${voiceSession.userTurns} + 1` })
      .where(eq(voiceSession.id, ctx.voiceSessionId));
    return row;
  }

  /** Append what Athena said, flagged when the person cut in. */
  async appendAssistantTurn(
    ctx: VoiceSessionContext,
    text: string,
    interrupted: boolean,
  ): Promise<VoiceTurnOut> {
    const row = await this.append(ctx, 'athena', text, interrupted);
    await db
      .update(voiceSession)
      .set({
        assistantTurns: sql`${voiceSession.assistantTurns} + 1`,
        ...(interrupted ? { interruptions: sql`${voiceSession.interruptions} + 1` } : {}),
      })
      .where(eq(voiceSession.id, ctx.voiceSessionId));
    return row;
  }

  /**
   * Record an action as started.
   *
   * @remarks
   * Written with `approvalStatus: 'executing'` rather than `'proposed'`. A voice turn has no place
   * to render an approval queue and no way for a person to read a diff while listening — the
   * action is happening, and the honest representation of that is a row that says so from the
   * moment it begins. The gated-proposal path remains the text surface's model.
   */
  async startAction(ctx: VoiceSessionContext, tool: string, at: Date): Promise<VoiceActionOut> {
    const [row] = await db
      .insert(sessionActivity)
      .values({
        sessionId: ctx.conversationId,
        organizationId: null,
        type: 'action',
        approvalStatus: 'executing',
        body: {
          action: { kind: tool, summary: `Working on ${tool.replace(/_/g, ' ')}…` },
          voice: this.marker(ctx, false),
        },
        createdAt: at,
      })
      .returning();
    if (!row) throw new Error('voice action insert returned no row');
    return {
      id: row.id,
      tool,
      summary: `Working on ${tool.replace(/_/g, ' ')}…`,
      status: 'running',
      startedAt: at.toISOString(),
      completedAt: null,
    };
  }

  /** Record the same action as finished, replacing its provisional summary with the real one. */
  async finishAction(
    ctx: VoiceSessionContext,
    action: VoiceActionOut,
    outcome: VoiceToolOutcome,
    at: Date,
  ): Promise<VoiceActionOut> {
    await db
      .update(sessionActivity)
      .set({
        approvalStatus: outcome.ok ? 'applied' : 'rejected',
        body: {
          action: {
            kind: action.tool,
            summary: outcome.summary,
            result: { content: outcome.summary, isError: !outcome.ok },
          },
          voice: this.marker(ctx, false),
        },
      })
      .where(eq(sessionActivity.id, action.id));
    return {
      ...action,
      summary: outcome.summary,
      status: outcome.ok ? 'done' : 'failed',
      completedAt: at.toISOString(),
    };
  }

  /** Close the `voice_session` row with a stable machine reason. */
  async recordSessionEnd(
    ctx: VoiceSessionContext,
    reason: VoiceEndReason,
    at: Date,
  ): Promise<void> {
    await db
      .update(voiceSession)
      .set({ status: 'ended', endedAt: at, endedReason: reason })
      .where(eq(voiceSession.id, ctx.voiceSessionId));
  }

  private marker(ctx: VoiceSessionContext, interrupted: boolean): VoiceActivityMarker {
    return { channel: ctx.channel, voiceSessionId: ctx.voiceSessionId, interrupted };
  }

  private async append(
    ctx: VoiceSessionContext,
    role: 'user' | 'athena',
    text: string,
    interrupted: boolean,
  ): Promise<VoiceTurnOut> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sessionActivity)
        .values({
          sessionId: ctx.conversationId,
          organizationId: null,
          type: 'response',
          body: {
            text,
            author: role === 'user' ? 'user' : 'athena',
            voice: this.marker(ctx, interrupted),
            ...(ctx.organizationId ? { context: { workspaceId: ctx.organizationId } } : {}),
          },
        })
        .returning();
      if (!row) throw new Error('voice turn insert returned no row');

      const messages = await loadTranscript(tx, ctx.conversationId);
      const appended: TurnMessage = {
        role: role === 'user' ? 'user' : 'assistant',
        content: [{ type: 'text', text }],
      };
      await saveTranscript(tx, ctx.conversationId, null, [...messages, appended], ctx.userId);

      return {
        id: row.id,
        role,
        text,
        channel: ctx.channel,
        interrupted,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
