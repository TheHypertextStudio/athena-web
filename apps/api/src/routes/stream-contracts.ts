/** Route-owned schemas and literal Server-Sent Events wire examples. */
import { SessionActivityOut } from '@docket/athena/agent-contract';
import { AGENT_UPDATE_KINDS } from '@docket/athena/agent-bus';
import { z } from 'zod';

import { StreamEventOut } from '../contracts/stream';
import { ApiError } from '../error';
import type { ApiOperationContract, ApiStreamEvent } from '../lib/api-operation-contract';

/** One documented SSE event name, payload schema, and complete wire frame. */
export interface SseEventContract {
  /** The value carried by the SSE `event` field. */
  readonly event: string;
  /** What receipt of this event means to a client. */
  readonly description: string;
  /** The reusable schema for the decoded `data` payload. */
  readonly payload: z.ZodType;
  /** A complete literal frame including its terminating blank line. */
  readonly wireExample: string;
}

const EmptyHeartbeatOut = z.object({}).strict();

const ROOT_EVENT_EXAMPLE = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  kind: 'created',
  occurredAt: '2026-08-02T12:00:00.000Z',
  title: 'Task created',
  summary: null,
  permalink: null,
  source: { system: 'docket', integrationId: null, externalUrl: null },
  actor: null,
  entity: null,
  participants: [],
  detail: null,
  createdAt: '2026-08-02T12:00:00.000Z',
  actorIsViewer: false,
  relevance: null,
  rendering: { icon: 'task', category: 'progress' },
} as const;

/** Root personal-feed events. This process-local stream does not expose resumable event ids. */
export const rootStreamEventContracts = [
  {
    event: 'stream-event',
    description: 'One visible activity event from a workspace that concerns the caller.',
    payload: StreamEventOut,
    wireExample: `event: stream-event\ndata: ${JSON.stringify(ROOT_EVENT_EXAMPLE)}\n\n`,
  },
  {
    event: 'ping',
    description: 'An empty heartbeat that keeps an otherwise idle connection open.',
    payload: EmptyHeartbeatOut,
    wireExample: 'event: ping\ndata: {}\n\n',
  },
] as const satisfies readonly SseEventContract[];

const ACTIVITY_TYPES = ['thought', 'action', 'response', 'elicitation', 'error'] as const;

/** Persisted session activity events used by personal and organization session streams. */
export const sessionActivityEventContracts = ACTIVITY_TYPES.map((type) => ({
  event: type,
  description: `One persisted ${type} activity from the agent session.`,
  payload: SessionActivityOut,
  wireExample: `id: 01ARZ3NDEKTSV4RRFFQ69G5FAX\nevent: ${type}\ndata: ${JSON.stringify({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
    organizationId: type === 'action' ? '01ARZ3NDEKTSV4RRFFQ69G5FAW' : null,
    type,
    body:
      type === 'action'
        ? { action: { kind: 'capture', summary: 'Create the task' } }
        : { text: 'Example activity' },
    approvalStatus: type === 'action' ? 'proposed' : null,
    createdAt: '2026-09-13T12:00:00.000Z',
  })}\n\n`,
})) satisfies readonly SseEventContract[];

/** The organization session stream's named heartbeat event. */
export const organizationHeartbeatEventContract = {
  event: 'ping',
  description: 'An empty heartbeat emitted while the organization session remains active.',
  payload: EmptyHeartbeatOut,
  wireExample: 'event: ping\ndata: {}\n\n',
} as const satisfies SseEventContract;

/** Decoded payload carried by every process-local merged-agent update event. */
export const AgentUpdateEventOut = z
  .object({
    sequence: z.number().int().positive(),
    sessionId: z.string(),
    parentSessionId: z.string().nullable(),
    taskId: z.string().nullable(),
    agentName: z.string(),
    milestone: z.string(),
    progress: z.number().min(0).max(100).nullable(),
    reasonCode: z.string().nullable(),
    at: z.iso.datetime(),
  })
  .meta({ id: 'AgentUpdateEventOut', description: 'One merged Athena agent progress update.' });

/** Process-local merged-agent events. These frames deliberately omit SSE ids. */
export const agentUpdateEventContracts = AGENT_UPDATE_KINDS.map((event, index) => ({
  event,
  description: `One process-local ${event} update for an agent owned by the caller.`,
  payload: AgentUpdateEventOut,
  wireExample: `event: ${event}\ndata: ${JSON.stringify({
    sequence: index + 1,
    sessionId: 'session_01',
    parentSessionId: null,
    taskId: null,
    agentName: 'Athena',
    milestone: `Example ${event}`,
    progress: event === 'agent_completed' ? 100 : null,
    reasonCode: event === 'agent_blocked' || event === 'agent_failed' ? 'example_reason' : null,
    at: '2026-09-13T12:00:00.000Z',
  })}\n\n`,
})) satisfies readonly SseEventContract[];

/** Convert a route-owned wire catalog into the public operation contract event shape. */
export function apiStreamEvents(contracts: readonly SseEventContract[]): readonly ApiStreamEvent[] {
  return contracts.map((contract) => ({
    name: contract.event,
    description: contract.description,
    schema: contract.payload,
    example: contract.wireExample,
  }));
}

/** Strict public contract for the process-local personal activity stream. */
export const personalActivityStreamOperation = {
  operationId: 'streamPersonalActivity',
  tag: 'Stream',
  summary: 'Stream personal activity',
  narrative: {
    purpose: 'Deliver visible workspace activity to the signed-in person as it happens.',
    behavior: [
      'Emits stream-event frames after rechecking task visibility at delivery time.',
      'Emits ping frames while the process-local subscription is idle.',
    ],
    constraints: [
      'This process-local stream is not resumable and rejects every Last-Event-ID value.',
    ],
  },
  access: { kind: 'session-only' },
  success: [
    {
      kind: 'sse',
      status: 200,
      events: apiStreamEvents(rootStreamEventContracts),
      resume: {
        kind: 'none',
        description: 'Reconnect without Last-Event-ID after the process or connection changes.',
      },
      description: 'A live, non-resumable Server-Sent Events feed for the caller.',
    },
  ],
  errors: ['unauthorized', 'validation_error'],
  conditionalRead: false,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} as const satisfies ApiOperationContract;

/** Strict public contract for the caller's merged process-local agent updates. */
export const personalAgentUpdatesStreamOperation = {
  operationId: 'streamPersonalAgentUpdates',
  tag: 'Athena',
  summary: 'Stream every running agent’s updates (SSE)',
  narrative: {
    purpose: 'Deliver the merged progress feed for every agent owned by the caller.',
    behavior: [
      'Replays up to 2,000 updates retained by this process and then emits new updates.',
      'Each frame identifies the agent session, task, milestone, and progress state.',
    ],
    constraints: [
      'The numeric sequence is process-local, so every Last-Event-ID value is rejected.',
    ],
  },
  access: { kind: 'session-only' },
  success: [
    {
      kind: 'sse',
      status: 200,
      events: apiStreamEvents(agentUpdateEventContracts),
      resume: {
        kind: 'none',
        description: 'Reconnect without Last-Event-ID after the process or connection changes.',
      },
      description: 'Merged agent updates as Server-Sent Events.',
    },
  ],
  errors: ['unauthorized', 'validation_error'],
  conditionalRead: false,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} as const satisfies ApiOperationContract;

/** Strict public contract for a caller-owned persisted Athena session stream. */
export const personalAthenaActivityStreamOperation = {
  operationId: 'streamPersonalAthenaSessionActivity',
  tag: 'Athena',
  summary: 'Stream personal Athena activity (SSE)',
  narrative: {
    purpose: 'Replay and live-tail the activity of one caller-owned Athena session.',
    behavior: [
      'A new connection receives the newest 100 persisted activities before live updates.',
      'A recognized Last-Event-ID resumes strictly after that persisted activity.',
    ],
    constraints: [
      'Older history remains available through the paginated JSON activity operation.',
      'An unknown or expired Last-Event-ID fails before the stream opens.',
    ],
  },
  access: { kind: 'session-only' },
  success: [
    {
      kind: 'sse',
      status: 200,
      events: apiStreamEvents(sessionActivityEventContracts),
      resume: {
        kind: 'last-event-id',
        header: 'Last-Event-ID',
        replayWindow: 'The newest 100 activities when the header is omitted.',
        description: 'Resume after the exact persisted activity id previously received.',
      },
      description: 'Personal session activity as a resumable Server-Sent Events stream.',
    },
  ],
  errors: ['unauthorized', 'not_found', 'validation_error'],
  conditionalRead: false,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} as const satisfies ApiOperationContract;

/** Strict public contract for a retained organization agent-session activity stream. */
export const organizationAgentActivityStreamOperation = {
  operationId: 'streamAgentSessionActivity',
  tag: 'Agents',
  summary: 'Stream agent session activity (SSE)',
  narrative: {
    purpose: 'Replay and live-tail one visible organization agent session.',
    behavior: [
      'A new connection replays all retained activity in createdAt and id order.',
      'Each persisted activity carries its id so a reconnect can resume after that position.',
    ],
    constraints: [
      'An unknown or expired Last-Event-ID fails before the stream opens.',
      'The caller must retain access throughout delivery; losing access closes the stream.',
    ],
  },
  access: { kind: 'session-only' },
  success: [
    {
      kind: 'sse',
      status: 200,
      events: apiStreamEvents([
        ...sessionActivityEventContracts,
        organizationHeartbeatEventContract,
      ]),
      resume: {
        kind: 'last-event-id',
        header: 'Last-Event-ID',
        replayWindow: 'All retained activity for the visible organization session.',
        description: 'Resume strictly after the persisted activity id previously received.',
      },
      description: 'Organization session activity as a resumable Server-Sent Events stream.',
    },
  ],
  errors: ['unauthorized', 'not_found', 'validation_error'],
  conditionalRead: false,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} as const satisfies ApiOperationContract;

/** Reject a resume header before opening a stream that cannot survive process epochs. */
export function rejectNonResumableCursor(lastEventId: string | undefined): void {
  if (lastEventId === undefined) return;
  throw new ApiError(
    422,
    'validation_error',
    'Last-Event-ID is not supported by this non-resumable stream',
  );
}

/** Build the validation Problem used when a persisted stream cursor cannot be resolved. */
export function unknownStreamCursor(): ApiError {
  return new ApiError(422, 'validation_error', 'Last-Event-ID is unknown or expired');
}
