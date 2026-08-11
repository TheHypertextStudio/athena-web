/**
 * `@docket/api` — opening, holding and closing a voice session, on either channel.
 *
 * @remarks
 * Both channels call {@link openVoiceSession}. It is the single place that:
 *
 * - resolves the person's **one** canonical Athena conversation (never a voice-only thread),
 * - checks the plan entitlement for the workspace that conversation belongs to,
 * - writes the `voice_session` row that records which call this was,
 * - and constructs the {@link VoiceSessionEngine} both channels then drive.
 *
 * The live engines live in a process-local registry keyed by session id. That is a deliberate
 * scope limit and it is written down rather than discovered: a voice session is bound to one
 * process for its lifetime, because the transport is too (a WebSocket to this instance, or a
 * browser relaying into it). If the process dies mid-call the session ends — which is the honest
 * behaviour, since the audio link died with it — and the transcript up to that moment is already
 * durable, because every turn was persisted as it happened rather than at hang-up.
 */
import { actor, db, organization, sessionActivity, user, voiceSession } from '@docket/db';
import type { VoiceChannel, VoiceEndReason, VoiceTurnOut } from '@docket/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { assertProductCapability } from '../billing/entitlement';
import { NotFoundError, ProductRequiredError } from '../error';

import { loadTranscript } from '../agent/transcript';
import { getContainer } from '../container';

import { resolveCanonicalConversation } from './agent-dispatch';
import { VoiceSessionEngine, type VoiceSessionContext } from './voice-engine';
import { voiceInstructions } from './voice-instructions';
import { AthenaVoiceResponder } from './voice-responder';
import type { VoiceProviderId } from './voice-provider';
import { DatabaseVoiceTranscriptStore } from './voice-store';
import { DocketVoiceToolRunner } from './voice-tools';

/** How many recent conversation lines are replayed into a fresh voice session's instructions. */
const RECENT_CONTEXT_LINES = 20;

/** How many characters of a single line survive into the instructions. */
const RECENT_CONTEXT_LINE_CHARS = 400;

/** The shared tool runner — stateless, scoped per call by the session context. */
const toolRunner = new DocketVoiceToolRunner();

/** The shared transcript store. */
const transcriptStore = new DatabaseVoiceTranscriptStore();

/** A live session and everything the transports need to keep driving it. */
export interface LiveVoiceSession {
  readonly engine: VoiceSessionEngine;
  readonly ctx: VoiceSessionContext;
  readonly provider: VoiceProviderId;
}

/** Process-local registry of live sessions. */
const live = new Map<string, LiveVoiceSession>();

/** What {@link openVoiceSession} needs to know. */
export interface OpenVoiceSessionInput {
  readonly userId: string;
  readonly channel: VoiceChannel;
  readonly provider: VoiceProviderId;
  /** Workspace focus; when absent the person's personal workspace is used. */
  readonly organizationId?: string | null;
  /** The provider's call identifier; required for, and only for, the phone channel. */
  readonly callSid?: string | null;
  /** The verified number the call came from. */
  readonly phoneNumberId?: string | null;
}

/** A freshly opened session. */
export interface OpenedVoiceSession extends LiveVoiceSession {
  readonly voiceSessionId: string;
  readonly conversationId: string;
  readonly startedAt: Date;
  /** Recent conversation, ready to be pinned into the realtime model's instructions. */
  readonly recentContext: string;
  /** The person's display name, for the greeting. */
  readonly speakerName: string;
}

/**
 * Resolve the workspace a person's voice session acts in.
 *
 * @remarks
 * Voice has no workspace switcher — you cannot see one while driving — so the channel needs a
 * defensible default. It is the person's personal workspace, which is the one workspace every
 * account has and the one whose contents are unambiguously theirs. An explicit
 * `organizationId` (the browser passes the workspace the person is looking at) always wins.
 *
 * @param userId - The account.
 * @param preferred - An explicitly chosen workspace, if any.
 * @returns the workspace id, or `null` when the account has none.
 */
export async function resolveVoiceWorkspace(
  userId: string,
  preferred?: string | null,
): Promise<string | null> {
  if (preferred) return preferred;
  // The membership actor is the edge that says "this account belongs to this workspace"; a
  // person always has one in their personal workspace, so one join answers the question.
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(actor, eq(actor.organizationId, organization.id))
    .where(
      and(
        eq(actor.userId, userId),
        eq(organization.isPersonal, true),
        isNull(organization.archivedAt),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Whether a workspace's plan entitles it to Athena, without throwing.
 *
 * @remarks
 * The phone channel needs the *answer*, not an exception: an unentitled caller is routed to a
 * friendly announcement, which is a normal outcome rather than an error. The web channel wants
 * the throw, because a 402 is what the upsell renders from. Both read the same rule — this
 * wraps {@link assertProductCapability} rather than reimplementing product ownership, so
 * the two can never drift.
 *
 * @param organizationId - The workspace whose plan is being checked.
 * @returns `true` when Athena may run.
 */
export async function isAthenaEntitled(organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false;
  try {
    await assertProductCapability(organizationId, 'voice');
    return true;
  } catch (error) {
    if (error instanceof ProductRequiredError || error instanceof NotFoundError) return false;
    throw error;
  }
}

/**
 * Open a voice session on the caller's one conversation.
 *
 * @remarks
 * Entitlement is asserted here, before the `voice_session` row exists, so an unentitled attempt
 * leaves no session, no engine and no turns behind.
 *
 * @param input - Who is calling, on which channel, from where.
 * @returns the opened session plus the material a greeting and instructions are built from.
 * @throws {ProductRequiredError} When the workspace does not own Docket Pro.
 */
export async function openVoiceSession(input: OpenVoiceSessionInput): Promise<OpenedVoiceSession> {
  const organizationId = await resolveVoiceWorkspace(input.userId, input.organizationId);
  await assertProductCapability(requireWorkspace(organizationId), 'voice');

  const conversation = await resolveCanonicalConversation(input.userId, organizationId);
  const [row] = await db
    .insert(voiceSession)
    .values({
      conversationId: conversation.id,
      userId: input.userId,
      organizationId,
      channel: input.channel,
      provider: input.provider,
      ...(input.callSid ? { callSid: input.callSid } : {}),
      ...(input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('voice session insert returned no row');

  const ctx: VoiceSessionContext = {
    voiceSessionId: row.id,
    conversationId: conversation.id,
    userId: input.userId,
    organizationId,
    channel: input.channel,
    initiatorActorId: conversation.initiatorId,
  };
  // A responder generates Athena's words on any channel whose provider does not. The telephone is
  // one (Twilio does speech-to-text and text-to-speech and no language model); the fixture
  // provider is the other, so a local browser session exercises the real engine, the real
  // persistence and the real tool dispatch with only the audio simulated. A real browser session
  // needs none of this: its speech-to-speech model generates in-band and reports itself through
  // transcript events.
  const responder =
    input.channel === 'phone' || input.provider === 'mock'
      ? new AthenaVoiceResponder(
          getContainer().agentTurn,
          voiceInstructions(
            await displayName(input.userId),
            await recentConversation(conversation.id),
          ),
        )
      : undefined;
  const engine = new VoiceSessionEngine(ctx, {
    store: transcriptStore,
    tools: toolRunner,
    ...(responder ? { responder } : {}),
    history: () => loadTranscript(db, conversation.id),
  });
  engine.begin();

  const session: LiveVoiceSession = { engine, ctx, provider: input.provider };
  live.set(row.id, session);

  return {
    ...session,
    voiceSessionId: row.id,
    conversationId: conversation.id,
    startedAt: row.startedAt,
    recentContext: await recentConversation(conversation.id),
    speakerName: await displayName(input.userId),
  };
}

/** Look up a live session this process is driving. */
export function liveVoiceSession(voiceSessionId: string): LiveVoiceSession | null {
  return live.get(voiceSessionId) ?? null;
}

/** Call sid → voice session id, so the media WebSocket can find the session the webhook opened. */
const byCallSid = new Map<string, string>();

/** Remember which call a session belongs to, so the WebSocket can find it by `callSid`. */
export function rememberCallSid(voiceSessionId: string, callSid: string): void {
  byCallSid.set(callSid, voiceSessionId);
}

/**
 * Look up a live session by the telephony provider's call identifier.
 *
 * @remarks
 * The inbound webhook opens the session and answers with TwiML; the media WebSocket arrives
 * moments later carrying only the call sid. This index is what joins the two halves of one call
 * without the socket having to re-resolve the caller (and re-decide entitlement) on its own.
 *
 * @param callSid - The provider's call identifier.
 */
export function liveVoiceSessionByCallSid(callSid: string): LiveVoiceSession | null {
  const id = byCallSid.get(callSid);
  return id ? (live.get(id) ?? null) : null;
}

/** Drop a finished session from the process registry. */
export function releaseVoiceSession(voiceSessionId: string): void {
  live.delete(voiceSessionId);
  for (const [sid, id] of byCallSid) {
    if (id === voiceSessionId) byCallSid.delete(sid);
  }
}

/**
 * Close a session that ended without the transport saying so.
 *
 * @remarks
 * Called when a socket drops or a browser stops relaying. The row is closed with a stable machine
 * reason so an operator can tell a hang-up from a crash without reading logs.
 *
 * @param voiceSessionId - The session to close.
 * @param reason - Why it ended.
 */
export async function closeVoiceSession(
  voiceSessionId: string,
  reason: VoiceEndReason,
): Promise<void> {
  const session = live.get(voiceSessionId);
  if (session) {
    await session.engine.receive([{ type: 'session.end', reason }]);
  } else {
    await db
      .update(voiceSession)
      .set({ status: 'ended', endedAt: new Date(), endedReason: reason })
      .where(and(eq(voiceSession.id, voiceSessionId), eq(voiceSession.status, 'active')));
  }
  releaseVoiceSession(voiceSessionId);
}

/**
 * Build the recent-conversation block pinned into a voice session's instructions.
 *
 * @remarks
 * This is what makes "the same conversation through every interface" true in the only way a
 * person can perceive: something typed on the web is remembered on the phone without being
 * restated. It reads the same `session_activity` rows the web timeline renders, so there is no
 * separate voice memory that could drift from what is on screen.
 *
 * @param conversationId - The canonical conversation.
 * @returns a plain-text transcript block, oldest first, or an empty string for a new conversation.
 */
export async function recentConversation(conversationId: string): Promise<string> {
  const rows = await db
    .select({ body: sessionActivity.body, createdAt: sessionActivity.createdAt })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, conversationId), eq(sessionActivity.type, 'response')))
    .orderBy(desc(sessionActivity.createdAt))
    .limit(RECENT_CONTEXT_LINES);

  return rows
    .reverse()
    .map((row) => {
      const text = typeof row.body.text === 'string' ? row.body.text : '';
      if (!text) return '';
      const who = row.body.author === 'athena' ? 'Athena' : 'They';
      return `${who}: ${text.slice(0, RECENT_CONTEXT_LINE_CHARS)}`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * The most recent lines of a person's one conversation, as voice turns.
 *
 * @remarks
 * Reads the same `session_activity` rows the web timeline renders, so the panel a person sees when
 * they enter voice is the conversation they were already having — including everything they typed.
 * A line's channel comes from the `body.voice` marker when it has one; a typed line reports `web`
 * because that is where it was typed.
 *
 * @param userId - The account.
 * @param limit - How many lines to return, oldest first.
 */
export async function recentTurns(
  userId: string,
  limit = RECENT_CONTEXT_LINES,
): Promise<readonly VoiceTurnOut[]> {
  const conversation = await resolveCanonicalConversation(userId, null);
  const rows = await db
    .select({
      id: sessionActivity.id,
      body: sessionActivity.body,
      createdAt: sessionActivity.createdAt,
    })
    .from(sessionActivity)
    .where(
      and(eq(sessionActivity.sessionId, conversation.id), eq(sessionActivity.type, 'response')),
    )
    .orderBy(desc(sessionActivity.createdAt))
    .limit(limit);

  return rows.reverse().flatMap((row) => {
    const text = typeof row.body.text === 'string' ? row.body.text.trim() : '';
    if (!text) return [];
    const marker = row.body['voice'];
    const voice =
      typeof marker === 'object' && marker !== null ? (marker as Record<string, unknown>) : {};
    return [
      {
        id: row.id,
        role: row.body.author === 'athena' ? ('athena' as const) : ('user' as const),
        text,
        channel: voice['channel'] === 'phone' ? ('phone' as const) : ('web' as const),
        interrupted: voice['interrupted'] === true,
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
}

/** The person's display name, for the greeting. */
async function displayName(userId: string): Promise<string> {
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return rows[0]?.name ?? '';
}

function requireWorkspace(organizationId: string | null): string {
  if (!organizationId) throw new NotFoundError('No workspace to talk about');
  return organizationId;
}
