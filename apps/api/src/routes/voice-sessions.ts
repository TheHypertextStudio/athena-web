/**
 * `@docket/api` — the browser voice channel, mounted at `/v1/me/athena/voice`.
 *
 * @remarks
 * This is the web channel's transport adapter. Like the phone one it holds no conversation logic:
 * it mints the browser's audio credential, relays the browser's realtime events into the shared
 * {@link VoiceSessionEngine}, and hands back the engine's commands. Turn-taking, persistence and
 * tool dispatch happen in the engine, exactly as they do for a phone call.
 *
 * ## Why the audio and the control plane are split
 *
 * The browser holds the audio link directly to the speech model (WebRTC, using an ephemeral
 * credential this route mints) and relays only *events* here — transcripts, tool calls, speech
 * boundaries. Audio never traverses Docket, so Docket adds no latency to the thing that is
 * latency-critical; and every decision with authority behind it (does this person's plan allow
 * this, may this tool run, what gets written to the conversation) still happens on the server,
 * where the authority actually is. A browser that lies about its events can only lie about its
 * own conversation.
 *
 * ## The mode is not a separate conversation
 *
 * `POST /` returns the caller's canonical conversation id — the same one `GET /v1/me/athena/chat`
 * returns. There is no "voice conversation" to fork from or merge back into.
 */
import {
  VoiceEventsAck,
  VoiceEventsBody,
  VoiceSessionOut,
  VoiceSessionStartBody,
  VoiceTurnOut,
} from '@docket/athena/voice';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import { callerGreeting } from './voice-announcements';
import { voiceInstructions } from './voice-instructions';
import type { VoiceRealtimeProvider } from './voice-provider';
import {
  closeVoiceSession,
  liveVoiceSession,
  openVoiceSession,
  recentTurns,
} from './voice-session-service';
import { VOICE_TOOL_DEFINITIONS } from './voice-tools';

const idParam = z.object({ id: z.string() });

/**
 * Build the browser voice routes.
 *
 * @param createProvider - Builds the realtime speech provider (real or fixture-backed) from the
 *   app container. A factory, not a resolved instance: the container's voice provider is lazy so
 *   a deploy that never opens a voice session isn't blocked at boot by credentials it doesn't
 *   have, and this route tree is built at module load, well before any request could need it.
 * @returns the Hono sub-app mounted at `/v1/me/athena/voice`.
 */
export function createVoiceRoutes(createProvider: () => VoiceRealtimeProvider) {
  return new Hono<AppEnv>()
    .post(
      '/',
      apiDoc({
        tag: 'Athena Voice',
        summary: 'Start a voice session on the caller’s conversation',
        response: VoiceSessionOut,
        description:
          'Open a live voice session and mint the short-lived credential the browser uses for its own audio link. Returns the caller’s one canonical conversation id — voice never starts a second conversation.',
      }),
      zJson(VoiceSessionStartBody),
      async (c) => {
        const userId = requireUserId(c);
        const body = c.req.valid('json');
        const provider = createProvider();
        const opened = await openVoiceSession({
          userId,
          channel: 'web',
          provider: provider.id,
          organizationId: body.workspaceId ?? null,
        });
        const greeting = callerGreeting(opened.speakerName);
        const credential = await provider.issueClientSession({
          instructions: voiceInstructions(opened.speakerName, opened.recentContext),
          tools: VOICE_TOOL_DEFINITIONS,
          greeting,
        });
        return ok(c, VoiceSessionOut, {
          id: opened.voiceSessionId,
          conversationId: opened.conversationId,
          channel: 'web',
          state: opened.engine.state,
          credential,
          greeting,
          tools: VOICE_TOOL_DEFINITIONS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
          startedAt: opened.startedAt.toISOString(),
          endedAt: null,
        });
      },
    )
    .get(
      '/transcript',
      apiDoc({
        tag: 'Athena Voice',
        summary: 'Read the recent conversation a voice session continues',
        response: z.object({ items: z.array(VoiceTurnOut) }),
        description:
          'The most recent lines of the caller’s one Athena conversation, from every channel, so entering voice continues the conversation on screen instead of starting a blank one.',
      }),
      async (c) => {
        const userId = requireUserId(c);
        return ok(c, z.object({ items: z.array(VoiceTurnOut) }), {
          items: [...(await recentTurns(userId))],
        });
      },
    )
    .post(
      '/:id/events',
      apiDoc({
        tag: 'Athena Voice',
        summary: 'Relay realtime events into the session engine',
        response: VoiceEventsAck,
        description:
          'Feed the browser’s realtime events — transcripts, speech boundaries, tool calls, interruptions — into the shared voice session engine, and receive the commands the client must obey.',
      }),
      zParam(idParam),
      zJson(VoiceEventsBody),
      async (c) => {
        const userId = requireUserId(c);
        const session = requireLive(c.req.valid('param').id, userId);
        const step = await session.engine.receive(c.req.valid('json').events);
        return ok(c, VoiceEventsAck, {
          state: step.state,
          commands: [...step.commands],
          turns: [...step.turns],
          actions: [...step.actions],
          trace: [...step.trace],
        });
      },
    )
    .delete(
      '/:id',
      apiDoc({
        tag: 'Athena Voice',
        summary: 'End a voice session',
        response: z.object({ ended: z.boolean() }),
        description: 'Close the live session and stamp the conversation with how it ended.',
      }),
      zParam(idParam),
      async (c) => {
        const userId = requireUserId(c);
        const id = c.req.valid('param').id;
        requireLive(id, userId);
        await closeVoiceSession(id, 'user_ended');
        return ok(c, z.object({ ended: z.boolean() }), { ended: true });
      },
    );
}

/**
 * Load a live session, refusing anything that is not the caller's.
 *
 * @remarks
 * Ownership is compared against the session's recorded owner rather than trusted from the path,
 * so knowing a session id is not sufficient to drive it. A session this process is not holding is
 * reported as not found — from the caller's side it is indistinguishable, and the alternative
 * (telling them it exists elsewhere) is information they cannot use.
 */
function requireLive(id: string, userId: string) {
  const session = liveVoiceSession(id);
  if (session?.ctx.userId !== userId) {
    throw new NotFoundError('Voice session not found');
  }
  return session;
}

function requireUserId(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError('Authentication required.');
  return userId;
}

export default createVoiceRoutes;
