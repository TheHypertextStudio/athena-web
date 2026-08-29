import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { HttpClient } from './http';
import { defaultHttpClient } from './http';
import type {
  AgentSurfaceAdapter,
  CanonicalAgentControl,
  ExternalRef,
  SurfaceTypeFamily,
} from './agent-surface';
import { canonicalActivityText } from './agent-surface';

const slackEventSchema = z.object({
  type: z.literal('event_callback'),
  team_id: z.string(),
  event_id: z.string(),
  event: z
    .object({
      type: z.enum(['app_mention', 'message']),
      user: z.string(),
      text: z.string(),
      channel: z.string(),
      ts: z.string(),
      thread_ts: z.string().optional(),
      channel_type: z.string().optional(),
      bot_id: z.string().optional(),
      subtype: z.string().optional(),
    })
    .loose(),
});

const slackInteractionSchema = z.object({
  type: z.literal('block_actions'),
  team: z.object({ id: z.string() }),
  user: z.object({ id: z.string(), name: z.string().optional() }),
  channel: z.object({ id: z.string() }),
  message: z.object({ ts: z.string(), thread_ts: z.string().optional() }),
  actions: z
    .array(z.object({ action_id: z.string(), action_ts: z.string(), value: z.string() }))
    .min(1),
});

const slackWebhookSchema = z.union([slackEventSchema, slackInteractionSchema]);

/** Verified Slack Events API or interactive delivery. */
export type SlackAgentWebhook = z.infer<typeof slackWebhookSchema>;

/** Slack app verification configuration. */
export interface SlackAgentVerification {
  readonly signingSecret: string;
}

/** One installed Slack bot. */
export interface SlackAgentInstall extends SlackAgentVerification {
  readonly botToken: string;
  readonly botUserId: string;
  readonly teamId: string;
  readonly http?: HttpClient;
}

/** Slack thread reference used for outbound messages. */
export interface SlackThreadRef extends ExternalRef {
  readonly channelId: string;
  readonly threadTs: string;
}

/** Slack message output with optional Block Kit controls. */
export interface SlackAgentMessageInput {
  readonly text: string;
  readonly blocks?: readonly Record<string, unknown>[];
}

/** Slack's external-agent wire family. */
export interface SlackSurfaceTypes extends SurfaceTypeFamily<'slack'> {
  readonly verification: SlackAgentVerification;
  readonly install: SlackAgentInstall;
  readonly webhook: SlackAgentWebhook;
  readonly workspaceRef: ExternalRef;
  readonly sessionRef: SlackThreadRef;
  readonly actorRef: ExternalRef;
  readonly nativeContext: { readonly channelId: string; readonly threadTs: string };
  readonly outbound: SlackAgentMessageInput;
  readonly receipt: ExternalRef;
}

function equalSignature(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function messageBlocks(
  text: string,
  control: CanonicalAgentControl | undefined,
): readonly Record<string, unknown>[] | undefined {
  if (!control) return undefined;
  const section = { type: 'section', text: { type: 'mrkdwn', text } };
  if (control.type === 'approval') {
    return [
      section,
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'athena_approve',
            value: control.approveToken,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'athena_reject',
            value: control.rejectToken,
          },
        ],
      },
    ];
  }
  if (control.type === 'authentication') {
    return [
      section,
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Connect Docket' },
            action_id: 'athena_auth',
            url: control.url,
          },
        ],
      },
    ];
  }
  return [
    section,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Stop Athena' },
          style: 'danger',
          action_id: 'athena_stop',
          value: control.stopToken,
        },
      ],
    },
  ];
}

/** Slack Agent adapter. */
export const slackAgentSurface: AgentSurfaceAdapter<'slack', SlackSurfaceTypes> = {
  provider: 'slack',
  capabilities: {
    progress: 'message_status',
    approval: 'buttons',
    authentication: 'button_link',
    stop: 'button',
    plans: false,
  },
  async verify(input, verification) {
    const signature = input.headers['x-slack-signature'];
    const timestamp = input.headers['x-slack-request-timestamp'];
    if (
      !signature ||
      !timestamp ||
      Math.abs(input.receivedAt.getTime() / 1_000 - Number(timestamp)) > 300
    ) {
      throw new Error('Slack webhook signature is missing or stale.');
    }
    const expected = `v0=${createHmac('sha256', verification.signingSecret)
      .update(`v0:${timestamp}:${input.body}`)
      .digest('hex')}`;
    if (!equalSignature(signature, expected))
      throw new Error('Slack webhook signature is invalid.');
    const contentType = input.headers['content-type'] ?? '';
    const rawPayload: unknown = contentType.includes('application/x-www-form-urlencoded')
      ? JSON.parse(new URLSearchParams(input.body).get('payload') ?? 'null')
      : JSON.parse(input.body);
    const payload = slackWebhookSchema.parse(rawPayload);
    const deliveryId =
      payload.type === 'event_callback'
        ? payload.event_id
        : `${payload.message.ts}:${payload.actions[0]?.action_ts ?? 'interaction'}`;
    return { deliveryId, eventType: payload.type, payload };
  },
  async normalize(input, install) {
    const payload = input.payload;
    if (payload.type === 'block_actions') {
      const action = payload.actions[0];
      if (!action) return [];
      const externalSessionId = `${payload.channel.id}:${payload.message.thread_ts ?? payload.message.ts}`;
      const actor = {
        externalId: payload.user.id,
        ...(payload.user.name ? { displayName: payload.user.name } : {}),
      };
      if (action.action_id === 'athena_stop') {
        return [
          {
            type: 'stop_requested',
            externalSessionId,
            externalActivityId: action.action_ts,
            actor,
          },
        ];
      }
      return [
        {
          type: 'approval_selected',
          externalSessionId,
          externalActivityId: action.action_ts,
          actor,
          choiceToken: action.value,
        },
      ];
    }
    const event = payload.event;
    if (event.bot_id || event.subtype === 'bot_message' || event.user === install.botUserId)
      return [];
    const threadTs = event.thread_ts ?? event.ts;
    const externalSessionId = `${event.channel}:${threadTs}`;
    const prompt = event.text.replace(new RegExp(`<@${install.botUserId}>`, 'g'), '').trim();
    const actor = { externalId: event.user };
    if (event.thread_ts) {
      return [
        {
          type: 'prompt_received',
          externalSessionId,
          externalActivityId: event.ts,
          actor,
          body: prompt,
        },
      ];
    }
    return [
      {
        type: 'session_started',
        workspaceId: payload.team_id,
        externalSessionId,
        actor,
        context: { prompt, guidance: [], references: [] },
        trigger: event.type === 'app_mention' ? 'mention' : 'message',
      },
    ];
  },
  render(activity) {
    const text = canonicalActivityText(activity);
    const blocks = messageBlocks(text, activity.control);
    return { text, ...(blocks ? { blocks } : {}) };
  },
  async publish(install, session, output) {
    const http = install.http ?? defaultHttpClient;
    const response = await http('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${install.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: session.channelId,
        thread_ts: session.threadTs,
        text: output.text,
        ...(output.blocks ? { blocks: output.blocks } : {}),
      }),
    });
    const result = z
      .object({ ok: z.boolean(), ts: z.string().optional(), error: z.string().optional() })
      .parse(await response.json());
    if (!response.ok || !result.ok || !result.ts)
      throw new Error('Slack did not accept the agent message.');
    return { id: result.ts };
  },
};
