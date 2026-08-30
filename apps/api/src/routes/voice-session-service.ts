/**
 * `@docket/api` — opening, holding and closing a voice session, on either channel.
 *
 * @remarks
 * Both channels call {@link openVoiceSession}. It is the single place that:
 *
 * - resolves the person's **one** canonical Athena conversation (never a voice-only thread),
 * - checks the Docket Pro capability for the workspace that conversation belongs to,
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
import {
  actor,
  db,
  organization,
  phoneCallAuthorization,
  sessionActivity,
  user,
  voiceSession,
} from '@docket/db';
import type { VoiceChannel, VoiceEndReason, VoiceTurnOut } from '@docket/athena/voice';
import type { VoiceSessionAuthorizationMethod } from '@docket/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { assertProductCapability } from '../product-capability';
import { NotFoundError, ProductRequiredError } from '../error';

import { markProvenanceInline } from '../agent/provenance';
import { loadTranscript } from '../agent/transcript';
import { getContainer } from '../container';

import { resolveCanonicalConversation } from './agent-dispatch';
import { publishPhoneCallSummary } from './phone-call-summary';
import { VoiceSessionEngine, type VoiceSessionContext } from './voice-engine';
import { voiceInstructions } from './voice-instructions';
import { AthenaVoiceResponder } from './voice-responder';
import type { VoiceProviderId } from './voice-provider';
import type { TelephonyProvider } from './twilio-telephony';
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
  /** Signal that authorized a phone session. */
  readonly authorizationMethod?: VoiceSessionAuthorizationMethod | null;
  /** Carrier attestation observed on inbound entry. */
  readonly stirVerification?: string | null;
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

/** The active human membership that authorizes one voice workspace focus. */
interface VoiceWorkspaceActor {
  readonly organizationId: string;
  readonly actorId: string;
}

/**
 * Resolve the workspace a person's voice session acts in.
 *
 * @remarks
 * Voice has no workspace switcher — you cannot see one while driving — so the channel needs a
 * defensible default. It is the person's personal workspace, which is the one workspace every
 * account has and the one whose contents are unambiguously theirs. An explicit
 * `organizationId` (the browser passes the workspace the person is looking at) wins only when
 * it names an active, unarchived human membership for that person.
 *
 * @param userId - The account.
 * @param preferred - An explicitly chosen workspace, if any.
 * @returns the workspace id, or `null` when the account has none.
 */
export async function resolveVoiceWorkspace(
  userId: string,
  preferred?: string | null,
): Promise<string | null> {
  const workspace = await resolveVoiceWorkspaceActor(userId, preferred);
  return workspace?.organizationId ?? null;
}

/** Resolve the active human actor that makes a workspace usable for this voice session. */
async function resolveVoiceWorkspaceActor(
  userId: string,
  preferred?: string | null,
): Promise<VoiceWorkspaceActor | null> {
  // The membership actor is the authorization edge, not just a convenient way to find an org.
  // Keeping this lookup shared by explicit browser focus and the phone's personal-workspace
  // fallback prevents either channel from minting a session for a departed or suspended person.
  const rows = await db
    .select({ organizationId: organization.id, actorId: actor.id })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        isNull(organization.archivedAt),
        preferred ? eq(organization.id, preferred) : eq(organization.isPersonal, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Whether a workspace has the Docket Pro voice capability, without throwing.
 *
 * @remarks
 * The phone channel needs the *answer*, not an exception: an unentitled caller is routed to a
 * friendly announcement, which is a normal outcome rather than an error. The web channel wants
 * the throw, because a 402 is what the upsell renders from. Both read the same rule — this
 * uses {@link assertProductCapability} rather than inferring access from lifecycle state, so
 * the two can never drift.
 *
 * @param organizationId - The organization whose Athena capability is being checked.
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
 * @throws {ProductRequiredError} When the workspace does not have the voice capability.
 */
export async function openVoiceSession(input: OpenVoiceSessionInput): Promise<OpenedVoiceSession> {
  const workspace = await resolveVoiceWorkspaceActor(input.userId, input.organizationId);
  if (!workspace) throw new NotFoundError('No workspace to talk about');
  const { organizationId, actorId } = workspace;
  await assertProductCapability(organizationId, 'voice');

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
      ...(input.authorizationMethod ? { authorizationMethod: input.authorizationMethod } : {}),
      ...(input.stirVerification ? { stirVerification: input.stirVerification } : {}),
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
    // A conversation can predate this call or have been started from a different workspace. The
    // membership actor we just verified is the only authority this voice session may use.
    initiatorActorId: actorId,
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
  await publishPhoneCallSummary(voiceSessionId);
}

/**
 * End every live call and pending callback tied to one phone binding.
 *
 * Local authorization is removed before the provider request. A provider outage therefore cannot
 * leave a cached relay able to run another tool after the user revoked access.
 */
export async function revokePhoneAccess(
  phoneNumberId: string,
  telephony: TelephonyProvider,
): Promise<void> {
  const sessions = await db
    .select({ id: voiceSession.id, callSid: voiceSession.callSid })
    .from(voiceSession)
    .where(and(eq(voiceSession.phoneNumberId, phoneNumberId), eq(voiceSession.status, 'active')));
  await db
    .update(phoneCallAuthorization)
    .set({ state: 'canceled', failureReason: 'phone_access_revoked', updatedAt: new Date() })
    .where(
      and(
        eq(phoneCallAuthorization.phoneNumberId, phoneNumberId),
        inArray(phoneCallAuthorization.state, [
          'awaiting_hangup',
          'dialing',
          'awaiting_digit',
          'authorized',
          'connected',
        ]),
      ),
    );
  for (const session of sessions) {
    await closeVoiceSession(session.id, 'phone_access_revoked');
  }
  const failures: string[] = [];
  for (const session of sessions) {
    if (!session.callSid) continue;
    try {
      await telephony.endCall(session.callSid);
    } catch {
      failures.push(session.callSid);
    }
  }
  if (failures.length > 0) throw new Error('telephony provider could not end an active call');
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
      // This block is pinned into the voice session's *system* instructions, which is a stronger
      // position than the user turn the transcript envelope already covers — and voice tool calls
      // are written `executing`, so nothing stops one. A row whose text came from an emailed or
      // relayed sender is therefore marked here too, rather than presented as the caller speaking.
      const marked = markProvenanceInline(
        text.slice(0, RECENT_CONTEXT_LINE_CHARS),
        row.body.provenance ?? 'principal',
        row.body.origin,
      );
      return `${who}: ${marked}`;
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
    // `role` only distinguishes Athena from not-Athena, so an emailed or relayed line would
    // otherwise render as the account owner speaking. Provenance rides alongside it so the panel
    // can attribute the line instead of the reader assuming they wrote it.
    const provenance = row.body.provenance ?? 'principal';
    return [
      {
        id: row.id,
        role: row.body.author === 'athena' ? ('athena' as const) : ('user' as const),
        text,
        channel: voice['channel'] === 'phone' ? ('phone' as const) : ('web' as const),
        interrupted: voice['interrupted'] === true,
        createdAt: row.createdAt.toISOString(),
        provenance,
        ...(row.body.origin ? { origin: row.body.origin } : {}),
      },
    ];
  });
}

/** The person's display name, for the greeting. */
async function displayName(userId: string): Promise<string> {
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return rows[0]?.name ?? '';
}
