/**
 * `@docket/api` — the MCP-backed boundary adapter, against the shapes a real client has.
 *
 * @remarks
 * The two tool shapes here are copied from the authoritative registry
 * (`curfew-protocols/schemas/mcp-tools.json`), not invented: submit takes `{ reason }` and
 * nothing else — there is no duration argument on the wire — and status answers with one of
 * `pending | approved | denied`.
 *
 * The registry declares structured output for both tools while the shipped implementation
 * returns prose (`"Extension request queued (ID: …)"`, `"Status: denied"` / `"Denial reason: …"`).
 * The adapter has to survive both, so both are exercised: the structured server below, and the
 * prose server beside it.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  McpDayBoundaryPort,
  readOutcome,
  readRequestId,
  type BoundaryToolCaller,
} from '../../../src/services/boundary/mcp-adapter';

/** The registry's own tool names. They reach the adapter as configuration, never as constants. */
const SUBMIT_TOOL = 'curfew.request_extension';
const STATUS_TOOL = 'curfew.request_status';

const TICKET = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** A text content block, the way the shipped implementation answers. */
function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/**
 * Stand up an in-memory MCP server exposing the two real tools and return a caller for it.
 *
 * @param handlers - What each tool answers.
 * @returns a tool caller wired through a genuine MCP client/server pair.
 */
async function connect(handlers: {
  submit: (args: { reason: string }) => CallToolResult;
  status: (args: { request_id: string }) => CallToolResult;
}): Promise<{ call: BoundaryToolCaller; seen: Record<string, unknown>[] }> {
  const seen: Record<string, unknown>[] = [];
  const server = new McpServer({ name: 'boundary-double', version: '1.0.0' });

  server.registerTool(
    SUBMIT_TOOL,
    {
      description: 'Queues a local user-consent request for a work-session extension.',
      // Exactly the registry's argument schema: a reason, 1–500 characters, and nothing else.
      inputSchema: { reason: z.string().min(1).max(500) },
    },
    (args) => {
      seen.push({ tool: SUBMIT_TOOL, ...args });
      return handlers.submit(args);
    },
  );
  server.registerTool(
    STATUS_TOOL,
    {
      description: 'Returns the current state of a local pending request.',
      inputSchema: { request_id: z.string() },
    },
    (args) => {
      seen.push({ tool: STATUS_TOOL, ...args });
      return handlers.status(args);
    },
  );

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const call: BoundaryToolCaller = async (name, args) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { call, seen };
}

describe('McpDayBoundaryPort — prose responses, as shipped', () => {
  it('submits only a reason, and reads the ticket out of the prose reply', async () => {
    const { call, seen } = await connect({
      submit: () =>
        text(
          `Extension request queued (ID: ${TICKET}).\n` +
            'Open the app to approve, or poll with the status tool.',
        ),
      status: () => text('Status: pending'),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    const submission = await port.submitExtensionRequest({
      minutes: 90,
      reason: 'Ninety minutes of work will not fit before today closes.',
    });
    expect(submission.requestId).toBe(TICKET);

    // The wire carries the reason and nothing else — `minutes` has nowhere to go, by design.
    expect(seen[0]).toEqual({
      tool: SUBMIT_TOOL,
      reason: 'Ninety minutes of work will not fit before today closes.',
    });
  });

  it('reads a denial and its note out of the prose status reply', async () => {
    const { call } = await connect({
      submit: () => text(`Queued (ID: ${TICKET}).`),
      status: () =>
        text(
          'Status: denied\nResolved at: 2026-08-12T22:10:00Z\nDenial reason: Not during a warning stage',
        ),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    await expect(port.pollExtensionRequest(TICKET)).resolves.toEqual({
      state: 'denied',
      detail: 'Not during a warning stage',
    });
  });

  it('treats a pruned request as unavailable rather than as a refusal', async () => {
    const { call } = await connect({
      submit: () => text(`Queued (ID: ${TICKET}).`),
      status: (args) => text(`Request ${args.request_id} not found (may have been pruned).`),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    const outcome = await port.pollExtensionRequest(TICKET);
    // Not `denied`: the person never said no, so this must never become a terminal refusal.
    expect(outcome.state).toBe('unavailable');
    expect(outcome.detail).toContain('not found');
  });
});

describe('McpDayBoundaryPort — structured responses, as the registry declares them', () => {
  it('prefers structured content when the client provides it', async () => {
    const { call } = await connect({
      submit: () => ({
        content: [{ type: 'text', text: 'queued' }],
        structuredContent: { request_id: TICKET },
      }),
      status: () => ({
        content: [{ type: 'text', text: 'approved' }],
        structuredContent: { status: 'approved' },
      }),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    await expect(port.submitExtensionRequest({ minutes: 60, reason: 'r' })).resolves.toEqual({
      requestId: TICKET,
    });
    await expect(port.pollExtensionRequest(TICKET)).resolves.toEqual({
      state: 'approved',
      detail: null,
    });
  });

  it('truncates a reason to the published 500-character maximum rather than being rejected', async () => {
    const { call, seen } = await connect({
      submit: () => text(`Queued (ID: ${TICKET}).`),
      status: () => text('Status: pending'),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    await port.submitExtensionRequest({ minutes: 30, reason: 'x'.repeat(900) });
    expect((seen[0] as { reason: string }).reason).toHaveLength(500);
  });

  it('raises rather than inventing a ticket when the client returned none', async () => {
    const { call } = await connect({
      submit: () => text('Something went sideways.'),
      status: () => text('Status: pending'),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });

    await expect(port.submitExtensionRequest({ minutes: 30, reason: 'r' })).rejects.toThrow(
      /no request id/,
    );
  });
});

describe('response readers', () => {
  it('reads a request id out of a JSON text block', () => {
    expect(readRequestId(text(JSON.stringify({ request_id: TICKET })))).toBe(TICKET);
  });

  it('maps every published status value, and nothing else', () => {
    expect(readOutcome(text('Status: pending')).state).toBe('pending');
    expect(readOutcome(text('Status: approved')).state).toBe('approved');
    expect(readOutcome(text('Status: denied')).state).toBe('denied');
    // `budget_exhausted` is deliberately never synthesized from prose — see the adapter's remarks.
    expect(readOutcome(text('Status: budget_exhausted')).state).toBe('unavailable');
    expect(readOutcome(text('')).state).toBe('unavailable');
    expect(readOutcome(text('')).detail).toBeNull();
  });

  it('prefers a structured denial note over the prose one', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'Status: denied\nDenial reason: prose note' }],
      structuredContent: { status: 'denied', denial_reason: 'structured note' },
    };
    expect(readOutcome(result)).toEqual({ state: 'denied', detail: 'structured note' });
  });

  it('ignores a non-object JSON text block rather than treating it as a payload', () => {
    expect(readOutcome(text('[1,2,3]')).state).toBe('unavailable');
  });
});

describe('error results', () => {
  it('throws on a submit the client answered with an error', async () => {
    const { call } = await connect({
      submit: () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
      status: () => text('Status: pending'),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });
    await expect(port.submitExtensionRequest({ minutes: 30, reason: 'r' })).rejects.toThrow(
      /refused/,
    );
  });

  it('reports a status error as unavailable, never as a refusal', async () => {
    const { call } = await connect({
      submit: () => text(`Queued (ID: ${TICKET}).`),
      status: () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    });
    const port = new McpDayBoundaryPort({
      submitToolName: SUBMIT_TOOL,
      statusToolName: STATUS_TOOL,
      call,
    });
    await expect(port.pollExtensionRequest(TICKET)).resolves.toEqual({
      state: 'unavailable',
      detail: null,
    });
  });
});
