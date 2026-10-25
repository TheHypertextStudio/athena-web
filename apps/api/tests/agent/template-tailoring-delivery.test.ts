/** Delivery and retry of saved-context requests honour their owner, state and retained context. */
import type * as Db from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { saveTranscript } from '../../src/agent/transcript';
import { prepareTailoredRequest, saveTailoredRequest } from '../../src/agent/template-tailoring';
import {
  deliverTailoredRequest,
  listTailoringSources,
  retryTailoredRequest,
  tailoringStatus,
} from '../../src/agent/template-tailoring-delivery';
import { ApiError, ConflictError } from '../../src/error';
import type * as AsyncRunner from '../../src/agent/async-runner';
import type * as Loop from '../../src/agent/loop';
import type * as SessionRunner from '../../src/routes/agent-session-runner';

const runner = vi.hoisted(() => ({
  admit: vi.fn(),
  drive: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('../../src/agent/async-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof AsyncRunner>()),
  admitAthenaGeneration: runner.admit,
}));
vi.mock('../../src/agent/loop', async (importOriginal) => ({
  ...(await importOriginal<typeof Loop>()),
  driveSession: runner.drive,
}));
vi.mock('../../src/routes/agent-session-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionRunner>()),
  postReplyAndResume: runner.resume,
}));

let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});
afterEach(() => {
  vi.clearAllMocks();
});

/** Seed a workspace member with one saved conversation and a saved pending request over it. */
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human required');
  const caller = { orgId: f.orgId, actorId: f.actorId, userId: f.ctx.principal.userId };
  const [row] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: caller.userId,
      contextOrganizationId: f.orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'completed',
    })
    .returning();
  const source = assertDefined(row);
  await saveTranscript(
    schema.db,
    source.id,
    null,
    [{ role: 'user', content: [{ type: 'text', text: 'We run a weekly food bank.' }] }],
    caller.userId,
  );
  const selection = { fork: 'nonprofit' as const, sessionIds: [source.id], importedTaskIds: [] };
  const preview = await prepareTailoredRequest(caller, selection);
  const request = await saveTailoredRequest(caller, {
    ...selection,
    fingerprint: preview.fingerprint,
  });
  return { ...f, caller, source, request };
}

async function setStatus(sessionId: string, status: 'pending' | 'completed' | 'failed') {
  await schema.db
    .update(schema.agentSession)
    .set({ status })
    .where(eq(schema.agentSession.id, sessionId));
}

/** Change the selected conversation so the request's retained fingerprint no longer matches. */
async function editSource(f: Awaited<ReturnType<typeof fixture>>) {
  await saveTranscript(
    schema.db,
    f.source.id,
    null,
    [{ role: 'user', content: [{ type: 'text', text: 'We now run two food banks.' }] }],
    f.caller.userId,
  );
}

describe('listTailoringSources', () => {
  it('reports authoring as unavailable when the live policy excludes the member', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));

    expect(await listTailoringSources(f.caller)).toEqual({
      availability: 'authoring_unavailable',
      conversations: [],
      importedWork: [],
    });
  });

  it('hides sources from an identity that is not an active member', async () => {
    const f = await fixture();
    await expect(listTailoringSources({ ...f.caller, actorId: f.sarahId })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('tailoringStatus', () => {
  it('hides a request owned by someone else and a session that is not a request', async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(tailoringStatus(other.caller, f.request.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(tailoringStatus(f.caller, f.source.id)).rejects.toMatchObject({ status: 404 });
    expect(await tailoringStatus(f.caller, f.request.id)).toEqual({
      sessionId: f.request.id,
      status: 'pending',
      proposalIds: [],
    });
  });
});

describe('deliverTailoredRequest', () => {
  it('drives a pending request in process when the runner admits it synchronously', async () => {
    const f = await fixture();
    runner.admit.mockResolvedValue({ mode: 'sync' });

    const status = await deliverTailoredRequest(f.caller, f.request.id);

    expect(status.sessionId).toBe(f.request.id);
    expect(runner.admit).toHaveBeenCalledTimes(1);
    expect(runner.drive).toHaveBeenCalledWith(f.orgId, f.request.id);
  });

  it('leaves a queued request to the asynchronous runner', async () => {
    const f = await fixture();
    runner.admit.mockResolvedValue({ mode: 'async', queued: { runId: 'run-1' } });

    await deliverTailoredRequest(f.caller, f.request.id);

    expect(runner.admit).toHaveBeenCalledTimes(1);
    expect(runner.drive).not.toHaveBeenCalled();
  });

  it('reports the current state when another attempt already owns the generation', async () => {
    const f = await fixture();
    runner.admit.mockRejectedValue(new ConflictError('Generation already leased'));

    expect(await deliverTailoredRequest(f.caller, f.request.id)).toMatchObject({
      sessionId: f.request.id,
      status: 'pending',
    });
    expect(runner.drive).not.toHaveBeenCalled();
  });

  it('surfaces a runner dispatch failure', async () => {
    const f = await fixture();
    runner.admit.mockRejectedValue(new ApiError(503, 'internal', 'dispatch failed'));

    await expect(deliverTailoredRequest(f.caller, f.request.id)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('returns a settled request without dispatching it again', async () => {
    const f = await fixture();
    await setStatus(f.request.id, 'completed');

    expect(await deliverTailoredRequest(f.caller, f.request.id)).toMatchObject({
      status: 'completed',
    });
    expect(runner.admit).not.toHaveBeenCalled();
  });

  it('refuses to dispatch after the selected context changed', async () => {
    const f = await fixture();
    await editSource(f);

    await expect(deliverTailoredRequest(f.caller, f.request.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(runner.admit).not.toHaveBeenCalled();
  });
});

describe('retryTailoredRequest', () => {
  it('resumes a failed request through the reply protocol as the requesting member', async () => {
    const f = await fixture();
    await setStatus(f.request.id, 'failed');

    expect(await retryTailoredRequest(f.caller, f.request.id)).toMatchObject({
      status: 'failed',
    });
    expect(runner.resume).toHaveBeenCalledTimes(1);
    expect(runner.resume.mock.calls[0]?.slice(0, 3)).toEqual([
      f.orgId,
      f.request.id,
      f.caller.actorId,
    ]);
    expect(runner.admit).not.toHaveBeenCalled();
  });

  it('delivers a request that has not started yet', async () => {
    const f = await fixture();
    runner.admit.mockResolvedValue({ mode: 'async', queued: { runId: 'run-1' } });

    await retryTailoredRequest(f.caller, f.request.id);

    expect(runner.admit).toHaveBeenCalledTimes(1);
    expect(runner.resume).not.toHaveBeenCalled();
  });

  it('leaves a completed request unchanged', async () => {
    const f = await fixture();
    await setStatus(f.request.id, 'completed');

    expect(await retryTailoredRequest(f.caller, f.request.id)).toMatchObject({
      status: 'completed',
    });
    expect(runner.resume).not.toHaveBeenCalled();
    expect(runner.admit).not.toHaveBeenCalled();
  });

  it('refuses to retry after the selected context changed', async () => {
    const f = await fixture();
    await setStatus(f.request.id, 'failed');
    await editSource(f);

    await expect(retryTailoredRequest(f.caller, f.request.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(runner.resume).not.toHaveBeenCalled();
  });
});
