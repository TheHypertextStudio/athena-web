/**
 * A connected third-party MCP server asking Athena a question.
 *
 * @remarks
 * Driven through the real MCP SDK over an in-memory transport pair rather than by calling the
 * handler directly: the point of the requirement is that a *server* can reach Athena at all, which
 * depends on the capability being advertised during initialization. A direct call would pass even
 * with the capability missing, which is exactly the bug this closes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// The low-level Server is the only way to send a raw `elicitation/create`; McpServer has no
// equivalent, which is why the deprecation is suppressed at each use site below.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ELICITATION_CLIENT_CAPABILITY as ElicitationClientCapability,
  handleMcpElicitation as HandleMcpElicitation,
  installElicitationHandler as InstallElicitationHandler,
} from '../../src/services/elicitation-mcp';
import type {
  answerElicitation as AnswerElicitation,
  listElicitationsFor as ListElicitationsFor,
  sweepElicitations as SweepElicitations,
} from '../../src/services/elicitation-service';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let installElicitationHandler!: typeof InstallElicitationHandler;
let ELICITATION_CLIENT_CAPABILITY!: typeof ElicitationClientCapability;
let handleMcpElicitation!: typeof HandleMcpElicitation;
let answerElicitation!: typeof AnswerElicitation;
let listElicitationsFor!: typeof ListElicitationsFor;
let sweepElicitations!: typeof SweepElicitations;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ installElicitationHandler, ELICITATION_CLIENT_CAPABILITY, handleMcpElicitation } =
    await import('../../src/services/elicitation-mcp'));
  ({ answerElicitation, listElicitationsFor, sweepElicitations } =
    await import('../../src/services/elicitation-service'));
});

interface Fixture {
  readonly ownerUserId: string;
  readonly sessionId: string;
}

/** Seed a workspace with a team so a question can create the task it implements. */
async function seed(): Promise<Fixture> {
  const slug = `mcp-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: owner!.id, preferences: {} });
  await db.insert(schema.actor).values({
    organizationId: org!.id,
    kind: 'human',
    displayName: 'Ada',
    userId: owner!.id,
    roleId: role!.id,
  });
  await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `M${slug.slice(-4)}` });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      contextOrganizationId: org!.id,
      kind: 'chat',
      trigger: 'delegation',
      status: 'running',
      workLinkage: 'conversation',
    })
    .returning({ id: schema.agentSession.id });
  return { ownerUserId: owner!.id, sessionId: session!.id };
}

/** Connect a bare MCP server to an Athena-shaped client and return both halves. */
async function connect(
  fixture: Fixture,
  timeoutMs = 60_000,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the import remark.
): Promise<{ server: Server; client: Client }> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the import remark.
  const server = new Server({ name: 'third-party', version: '1.0.0' }, { capabilities: {} });
  const client = new Client(
    { name: 'docket-athena', version: '1.0.0' },
    { capabilities: ELICITATION_CLIENT_CAPABILITY },
  );
  installElicitationHandler(client, {
    sessionId: fixture.sessionId,
    serverName: 'Deploy Bot',
    timeoutMs,
    pollMs: 5,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

/** Wait until the question the server raised exists, then return it. */
async function awaitRaised(fixture: Fixture): Promise<{ id: string; spec: unknown }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await listElicitationsFor(fixture.ownerUserId);
    const pending = rows.find((entry) => entry.row.status === 'pending');
    if (pending) return { id: pending.row.id, spec: pending.row.spec };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no elicitation was raised');
}

describe('ATH-47 — a third-party MCP server can ask Athena', () => {
  it('advertises the elicitation client capability during initialization', async () => {
    const fixture = await seed();
    const { server } = await connect(fixture);

    expect(server.getClientCapabilities()?.elicitation).toBeDefined();
  });

  it('renders the request from its own schema and returns accept with the answer', async () => {
    const fixture = await seed();
    const { server } = await connect(fixture);

    const pending = server.elicitInput({
      message: 'Which branch should I deploy?',
      requestedSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', enum: ['main', 'next'], enumNames: ['Main', 'Next'] },
        },
        required: ['branch'],
      },
    });

    const raised = await awaitRaised(fixture);
    // Rendered in Athena's own chrome, from the request's schema: a select with the server's labels.
    expect(raised.spec).toMatchObject({
      kind: 'form',
      fields: [
        {
          key: 'branch',
          required: true,
          control: {
            kind: 'select',
            options: [
              { value: 'main', label: 'Main' },
              { value: 'next', label: 'Next' },
            ],
          },
        },
      ],
    });
    await answerElicitation({
      elicitationId: raised.id,
      userId: fixture.ownerUserId,
      value: { branch: 'next' },
    });

    await expect(pending).resolves.toMatchObject({
      action: 'accept',
      content: { branch: 'next' },
    });
  });

  it('returns decline when the person answers a confirmation with no', async () => {
    const fixture = await seed();
    const { server } = await connect(fixture);

    const pending = server.elicitInput({
      message: 'Force-push over the remote branch?',
      requestedSchema: {
        type: 'object',
        properties: { confirmed: { type: 'boolean', title: 'Force push?' } },
        required: ['confirmed'],
      },
    });

    const raised = await awaitRaised(fixture);
    await answerElicitation({
      elicitationId: raised.id,
      userId: fixture.ownerUserId,
      value: { confirmed: false },
    });

    await expect(pending).resolves.toEqual({ action: 'decline' });
  });

  it('returns cancel when the deadline passes with nobody answering', async () => {
    const fixture = await seed();
    // The shortest wait the contract allows, so the sweep can settle it inside the test.
    const { server } = await connect(fixture, 60_000);

    const pending = server.elicitInput({
      message: 'Which environment?',
      requestedSchema: {
        type: 'object',
        properties: { env: { type: 'string', enum: ['staging', 'prod'] } },
        required: ['env'],
      },
    });

    const raised = await awaitRaised(fixture);
    // A third party's question is never auto-answerable, so the sweep must park it.
    const swept = await sweepElicitations(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(swept.parked).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.id));
    expect(row?.status).toBe('parked');
    expect(row?.answer).toBeNull();

    await expect(pending).resolves.toEqual({ action: 'cancel' });
  });

  it('cancels rather than guessing when the requested schema cannot be rendered', async () => {
    const fixture = await seed();
    const { server } = await connect(fixture);

    // The SDK's own request validator refuses a non-primitive property outright, so a
    // spec-conformant server cannot even put this on the wire — which is the first line of
    // defence.
    await expect(
      server.elicitInput({
        message: 'Configure the deploy',
        requestedSchema: { type: 'object', properties: { matrix: { type: 'array' } } } as never,
      }),
    ).rejects.toThrow();

    // The second line of defence is Docket's own: handed a schema it cannot render, the bridge
    // answers `cancel` so the server takes its fallback path, and puts nothing in front of the
    // person that they could not correctly answer.
    await expect(
      handleMcpElicitation(
        {
          message: 'Configure the deploy',
          requestedSchema: { type: 'object', properties: { matrix: { type: 'array' } } },
        },
        { sessionId: fixture.sessionId, serverName: 'Deploy Bot', pollMs: 5 },
      ),
    ).resolves.toEqual({ action: 'cancel' });
    expect(await listElicitationsFor(fixture.ownerUserId)).toHaveLength(0);
  });
});
