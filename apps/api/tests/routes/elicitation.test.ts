/**
 * The elicitation contract, tested against persisted state rather than call logs.
 *
 * @remarks
 * Every requirement here is of the form "and the system refused to do the other thing" — an
 * invalid answer is not recorded, a forged option is not accepted, a destructive question is not
 * auto-answered — so each case asserts on rows and counts after the fact, which a mock's call log
 * could not show.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  answerElicitation as AnswerElicitation,
  cancelElicitation as CancelElicitation,
  describeElicitationAnswer as DescribeElicitationAnswer,
  elicitationRequestFromToolInput as ElicitationRequestFromToolInput,
  listElicitationsFor as ListElicitationsFor,
  materializeElicitations as MaterializeElicitations,
  raiseElicitation as RaiseElicitation,
  readAthenaPresence as ReadAthenaPresence,
  recordAthenaPresence as RecordAthenaPresence,
  sweepElicitations as SweepElicitations,
  toElicitationOut as ToElicitationOut,
} from '../../src/services/elicitation-service';
import type { notifyElicitation as NotifyElicitation } from '../../src/services/elicitation-notify';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let raiseElicitation!: typeof RaiseElicitation;
let answerElicitation!: typeof AnswerElicitation;
let cancelElicitation!: typeof CancelElicitation;
let sweepElicitations!: typeof SweepElicitations;
let listElicitationsFor!: typeof ListElicitationsFor;
let materializeElicitations!: typeof MaterializeElicitations;
let elicitationRequestFromToolInput!: typeof ElicitationRequestFromToolInput;
let describeElicitationAnswer!: typeof DescribeElicitationAnswer;
let recordAthenaPresence!: typeof RecordAthenaPresence;
let readAthenaPresence!: typeof ReadAthenaPresence;
let toElicitationOut!: typeof ToElicitationOut;
let notifyElicitation!: typeof NotifyElicitation;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({
    raiseElicitation,
    answerElicitation,
    cancelElicitation,
    sweepElicitations,
    listElicitationsFor,
    materializeElicitations,
    elicitationRequestFromToolInput,
    describeElicitationAnswer,
    recordAthenaPresence,
    readAthenaPresence,
    toElicitationOut,
  } = await import('../../src/services/elicitation-service'));
  ({ notifyElicitation } = await import('../../src/services/elicitation-notify'));
});

interface Fixture {
  readonly ownerUserId: string;
  readonly ownerActorId: string;
  readonly orgId: string;
  readonly sessionId: string;
  readonly taskId: string;
}

/** Seed a workspace with a team (so a task can land) and one Athena conversation. */
async function seed(options: { withTask?: boolean } = {}): Promise<Fixture> {
  const slug = `elc-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const statusId = await seedStatuses(db, schema, assertDefined(org).id);
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: assertDefined(org).id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: assertDefined(owner).id, preferences: {} });
  const [ownerActor] = await db
    .insert(schema.actor)
    .values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(owner).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  await db
    .insert(schema.team)
    .values({ organizationId: assertDefined(org).id, name: 'Core', key: `E${slug.slice(-4)}` });

  let taskId = '';
  if (options.withTask) {
    const [teamRow] = await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(eq(schema.team.organizationId, assertDefined(org).id))
      .limit(1);
    const [created] = await db
      .insert(schema.task)
      .values({
        organizationId: assertDefined(org).id,
        title: 'Weekly sprint update',
        teamId: assertDefined(teamRow).id,
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        createdBy: assertDefined(ownerActor).id,
      })
      .returning({ id: schema.task.id });
    taskId = assertDefined(created).id;
  }

  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: assertDefined(owner).id,
      contextOrganizationId: assertDefined(org).id,
      kind: 'chat',
      trigger: 'delegation',
      status: 'awaiting_input',
      workLinkage: 'conversation',
      ...(taskId ? { taskId } : {}),
    })
    .returning({ id: schema.agentSession.id });

  return {
    ownerUserId: assertDefined(owner).id,
    ownerActorId: assertDefined(ownerActor).id,
    orgId: assertDefined(org).id,
    sessionId: assertDefined(session).id,
    taskId,
  };
}

const CONFIRM_SPEC = {
  kind: 'confirm' as const,
  confirmLabel: 'Post it',
  declineLabel: 'Hold off',
};

const SELECT_SPEC = {
  kind: 'select' as const,
  multiple: false,
  options: [
    { value: 'acme', label: 'Acme channel', description: null },
    { value: 'ops', label: 'Ops channel', description: null },
  ],
};

/** Raise one question with sensible defaults. */
async function raise(
  fixture: Fixture,
  overrides: Partial<Parameters<typeof RaiseElicitation>[0]['request']> = {},
  input: Partial<Parameters<typeof RaiseElicitation>[0]> = {},
): Promise<Awaited<ReturnType<typeof RaiseElicitation>>> {
  return raiseElicitation({
    sessionId: fixture.sessionId,
    request: {
      question: 'Should I post the sprint update now?',
      actionSummary: 'Post the sprint update to the Acme project channel',
      spec: CONFIRM_SPEC,
      timeoutPolicy: 'ambiguous',
      autoResolveValue: null,
      autoResolveReason: null,
      timeSensitive: false,
      ...overrides,
    },
    ...input,
  });
}

describe('typed, schema-validated answers', () => {
  it('rejects an invalid payload with field-level errors and leaves the question open', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture, {
      spec: {
        kind: 'form',
        fields: [
          {
            key: 'channel',
            label: 'Channel',
            description: null,
            required: true,
            control: SELECT_SPEC,
          },
          {
            key: 'note',
            label: 'Note',
            description: null,
            required: true,
            control: {
              kind: 'text',
              multiline: true,
              minLength: 5,
              maxLength: null,
              placeholder: null,
            },
          },
        ],
      },
    });

    const result = await answerElicitation({
      elicitationId: raised.elicitation.id,
      userId: fixture.ownerUserId,
      value: { channel: 'acme', note: 'hi' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.errors).toEqual([{ path: 'note', text: 'This answer is too short.' }]);
    const [row] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.status).toBe('pending');
    expect(row?.answer).toBeNull();
    expect(row?.settledAt).toBeNull();
  });

  it('delivers the accepted answer to the waiting agent as parsed typed data', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture, {}, { toolUseId: 'toolu_1' });

    const result = await answerElicitation({
      elicitationId: raised.elicitation.id,
      userId: fixture.ownerUserId,
      value: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected acceptance');
    // The persisted answer is a boolean, not the string "Post it".
    expect(result.value).toBe(true);
    const [row] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.answer).toBe(true);
    expect(row?.resolver).toBe('user');

    // The transcript row the agent loop reconciles against carries the typed value AND pairs to
    // the exact tool_use it is waiting on.
    const responses = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, fixture.sessionId),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(responses).toHaveLength(1);
    expect(responses[0]?.body['elicitationAnswer']).toBe(true);
    expect(responses[0]?.body['toolUseId']).toBe('toolu_1');
    expect(responses[0]?.body.text).toBe('Post it');
  });

  it('refuses a forged option that is not in the declared set', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture, { spec: SELECT_SPEC });

    const result = await answerElicitation({
      elicitationId: raised.elicitation.id,
      userId: fixture.ownerUserId,
      value: 'engineering',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.errors[0]?.text).toBe('Choose one of the options offered.');
  });

  it('refuses a second answer to an already settled question', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture);
    await answerElicitation({
      elicitationId: raised.elicitation.id,
      userId: fixture.ownerUserId,
      value: true,
    });

    await expect(
      answerElicitation({
        elicitationId: raised.elicitation.id,
        userId: fixture.ownerUserId,
        value: false,
      }),
    ).rejects.toThrow();
  });

  it('hides a question addressed to someone else', async () => {
    const fixture = await seed({ withTask: true });
    const other = await seed({ withTask: true });
    const raised = await raise(fixture);

    await expect(
      answerElicitation({
        elicitationId: raised.elicitation.id,
        userId: other.ownerUserId,
        value: true,
      }),
    ).rejects.toThrow();
  });
});

describe('every question has a deadline and a task', () => {
  it('persists an explicit deadline on every question', async () => {
    const fixture = await seed({ withTask: true });
    const now = new Date('2026-08-02T12:00:00.000Z');

    const raised = await raise(fixture, {}, { now, ttlMs: 15 * 60 * 1000 });

    expect(raised.elicitation.expiresAt.toISOString()).toBe('2026-08-02T12:15:00.000Z');
  });

  it('creates the task a question implements when the session has none', async () => {
    const fixture = await seed();
    const raised = await raise(fixture);

    expect(raised.taskId).not.toBe('');
    const [taskRow] = await db.select().from(schema.task).where(eq(schema.task.id, raised.taskId));
    // Titled with the action being authorized, because that is the work.
    expect(taskRow?.title).toBe('Post the sprint update to the Acme project channel');
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, fixture.sessionId));
    expect(sessionRow?.taskId).toBe(raised.taskId);
  });

  it('makes a task-less question unrepresentable at the schema level', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture);

    await expect(
      db
        .update(schema.agentElicitation)
        .set({ taskId: null as unknown as string })
        .where(eq(schema.agentElicitation.id, raised.elicitation.id)),
    ).rejects.toThrow();
  });

  it('refuses to claim a derivable default it was not given', async () => {
    const fixture = await seed({ withTask: true });

    await expect(
      db.insert(schema.agentElicitation).values({
        sessionId: fixture.sessionId,
        activityId: assertDefined(
          (
            await db
              .insert(schema.sessionActivity)
              .values({ sessionId: fixture.sessionId, type: 'elicitation', body: {} })
              .returning({ id: schema.sessionActivity.id })
          )[0],
        ).id,
        askedUserId: fixture.ownerUserId,
        taskId: fixture.taskId,
        question: 'q',
        actionSummary: 'a',
        spec: CONFIRM_SPEC,
        timeoutPolicy: 'derivable',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('what a deadline may and may not do', () => {
  it('answers a derivable question as Athena, with her reasoning in the transcript', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(
      fixture,
      {
        spec: SELECT_SPEC,
        timeoutPolicy: 'derivable',
        autoResolveValue: 'acme',
        autoResolveReason: 'Every previous update in this project went to the Acme channel.',
      },
      { now: new Date('2026-08-02T12:00:00.000Z') },
    );

    const swept = await sweepElicitations(new Date('2026-08-02T13:00:00.000Z'));

    expect(swept.autoResolved).toBe(1);
    const [row] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.status).toBe('auto_resolved');
    expect(row?.resolver).toBe('athena');
    expect(row?.answer).toBe('acme');
    const responses = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, fixture.sessionId),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(responses[0]?.body.author).toBe('athena');
    expect(responses[0]?.body.text).toContain('Acme channel');
    expect(responses[0]?.body.text).toContain('Every previous update');
  });

  it('parks a destructive question and mutates nothing for its task', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(
      fixture,
      {
        question: 'Delete the archived Substack import?',
        actionSummary: 'Permanently delete 412 imported posts',
        timeoutPolicy: 'destructive',
      },
      { now: new Date('2026-08-02T12:00:00.000Z') },
    );
    const [before] = await db.select().from(schema.task).where(eq(schema.task.id, raised.taskId));

    const swept = await sweepElicitations(new Date('2026-08-02T13:00:00.000Z'));

    expect(swept.parked).toBe(1);
    expect(swept.autoResolved).toBe(0);
    const [row] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.status).toBe('parked');
    expect(row?.answer).toBeNull();
    // Zero mutations for that task after the deadline.
    const [after] = await db.select().from(schema.task).where(eq(schema.task.id, raised.taskId));
    expect(after).toEqual(before);
    // No applied action was recorded either.
    const actions = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, fixture.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    expect(actions).toHaveLength(0);
    // And the person is told, in Docket's own words.
    const responses = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, fixture.sessionId),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(responses[0]?.body.text).toContain('cannot be undone');
    expect(responses[0]?.body.text).toContain('on hold until you answer');
  });

  it('parks an ambiguous question rather than picking one of two equal answers', async () => {
    const fixture = await seed({ withTask: true });
    await raise(
      fixture,
      { spec: SELECT_SPEC, timeoutPolicy: 'ambiguous' },
      { now: new Date('2026-08-02T12:00:00.000Z') },
    );

    const swept = await sweepElicitations(new Date('2026-08-02T13:00:00.000Z'));

    expect(swept).toEqual({ autoResolved: 0, parked: 1 });
  });

  it('downgrades a derivable claim whose default does not satisfy its own schema', async () => {
    const fixture = await seed({ withTask: true });

    const raised = await raise(fixture, {
      spec: SELECT_SPEC,
      timeoutPolicy: 'derivable',
      autoResolveValue: 'not-an-option',
      autoResolveReason: 'wishful thinking',
    });

    expect(raised.elicitation.timeoutPolicy).toBe('ambiguous');
    expect(raised.elicitation.autoResolveValue).toBeNull();
  });

  it('leaves nothing pending past its deadline', async () => {
    const fixture = await seed({ withTask: true });
    await raise(fixture, {}, { now: new Date('2026-08-02T12:00:00.000Z') });
    await raise(
      fixture,
      { question: 'Second', timeoutPolicy: 'destructive' },
      { now: new Date('2026-08-02T12:00:00.000Z') },
    );

    await sweepElicitations(new Date('2026-08-03T12:00:00.000Z'));

    const stillPending = await db
      .select()
      .from(schema.agentElicitation)
      .where(
        and(
          eq(schema.agentElicitation.sessionId, fixture.sessionId),
          eq(schema.agentElicitation.status, 'pending'),
        ),
      );
    expect(stillPending).toHaveLength(0);
  });

  it('re-sweeping settled questions changes nothing', async () => {
    const fixture = await seed({ withTask: true });
    await raise(fixture, {}, { now: new Date('2026-08-02T12:00:00.000Z') });
    await sweepElicitations(new Date('2026-08-02T13:00:00.000Z'));

    expect(await sweepElicitations(new Date('2026-08-02T14:00:00.000Z'))).toEqual({
      autoResolved: 0,
      parked: 0,
    });
  });
});

describe('liveness follows recorded presence', () => {
  it('marks a question live when the person is watching and absent when they are not', async () => {
    const fixture = await seed({ withTask: true });
    const now = new Date('2026-08-02T12:00:00.000Z');

    await recordAthenaPresence(fixture.ownerUserId, true, now);
    const live = await raise(fixture, { question: 'Live one' }, { now });

    await recordAthenaPresence(fixture.ownerUserId, false, now);
    const absent = await raise(fixture, { question: 'Absent one' }, { now });

    expect(live.live).toBe(true);
    expect(absent.live).toBe(false);
  });

  it('treats a stale heartbeat as absent', async () => {
    const fixture = await seed({ withTask: true });
    await recordAthenaPresence(fixture.ownerUserId, true, new Date('2026-08-02T12:00:00.000Z'));

    const presence = await readAthenaPresence(
      fixture.ownerUserId,
      new Date('2026-08-02T12:05:00.000Z'),
    );

    expect(presence.live).toBe(false);
    expect(presence.lastSeenAt?.toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });
});

describe('every question names the action it authorizes', () => {
  it('carries the action summary onto the row, the transcript, and the wire', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture);

    expect(raised.elicitation.actionSummary).toBe(
      'Post the sprint update to the Acme project channel',
    );
    const [activity] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, raised.activityId));
    expect(activity?.body['actionSummary']).toBe(
      'Post the sprint update to the Acme project channel',
    );
    expect(activity?.body['elicitationId']).toBe(raised.elicitation.id);

    const [entry] = await listElicitationsFor(fixture.ownerUserId);
    const out = toElicitationOut(assertDefined(entry));
    expect(out.actionSummary).toBe('Post the sprint update to the Acme project channel');
    expect(out.task.id).toBe(raised.taskId);
    expect(out.task.title).toBeTruthy();
    expect(out.task.href).toContain(raised.taskId);
  });

  it('falls back to the question only when the model supplies no action summary', () => {
    const request = elicitationRequestFromToolInput({ question: 'Which channel?' });

    expect(request.actionSummary).toBe('Which channel?');
    expect(request.timeoutPolicy).toBe('ambiguous');
    expect(request.spec.kind).toBe('text');
  });
});

describe('the agent loop’s ask_user path', () => {
  it('materializes a typed question from what the model wrote on the transcript', async () => {
    const fixture = await seed({ withTask: true });
    const [activity] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: fixture.sessionId,
        type: 'elicitation',
        body: {
          text: 'Which channel should this go to?',
          actionSummary: 'Post the sprint update',
          responseType: 'select',
          options: [
            { value: 'acme', label: 'Acme channel' },
            { value: 'ops', label: 'Ops channel' },
          ],
          timeSensitive: true,
          toolUseId: 'toolu_9',
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const [materialized] = await materializeElicitations(fixture.sessionId);

    expect(materialized?.elicitation.activityId).toBe(assertDefined(activity).id);
    expect(materialized?.elicitation.spec).toEqual(SELECT_SPEC);
    expect(materialized?.elicitation.toolUseId).toBe('toolu_9');
    expect(materialized?.elicitation.timeSensitive).toBe(true);
    // Idempotent: running again finds nothing left to do.
    expect(await materializeElicitations(fixture.sessionId)).toEqual([]);
  });

  it('normalizes every response type the tool advertises', () => {
    expect(
      elicitationRequestFromToolInput({
        question: 'When?',
        actionSummary: 'Schedule the send',
        responseType: 'datetime',
        precision: 'date',
        timeZone: 'America/Chicago',
      }).spec,
    ).toEqual({
      kind: 'datetime',
      precision: 'date',
      timeZone: 'America/Chicago',
      min: null,
      max: null,
    });
    expect(
      elicitationRequestFromToolInput({
        question: 'Upload it',
        actionSummary: 'Attach the brief',
        responseType: 'file',
        accept: ['application/pdf'],
      }).spec,
    ).toEqual({ kind: 'file', accept: ['application/pdf'], maxBytes: 26_214_400, multiple: false });
    expect(
      elicitationRequestFromToolInput({
        question: 'Details?',
        actionSummary: 'File the request',
        responseType: 'form',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'urgent', label: 'Urgent', type: 'confirm', required: false },
        ],
      }).spec,
    ).toMatchObject({
      kind: 'form',
      fields: [
        { key: 'title', label: 'Title', required: true, control: { kind: 'text' } },
        { key: 'urgent', label: 'Urgent', required: false, control: { kind: 'confirm' } },
      ],
    });
    // A select with no usable options degrades to text rather than rendering an empty picker.
    expect(
      elicitationRequestFromToolInput({
        question: 'Pick',
        actionSummary: 'Pick',
        responseType: 'select',
        options: [],
      }).spec.kind,
    ).toBe('text');
  });
});

describe('answer rendering', () => {
  it('renders each answer shape as a sentence rather than a payload', () => {
    expect(describeElicitationAnswer(CONFIRM_SPEC, false)).toBe('Hold off');
    expect(describeElicitationAnswer(SELECT_SPEC, 'ops')).toBe('Ops channel');
    expect(
      describeElicitationAnswer(
        {
          kind: 'form',
          fields: [
            { key: 'go', label: 'Go', description: null, required: true, control: CONFIRM_SPEC },
            {
              key: 'chan',
              label: 'Channel',
              description: null,
              required: true,
              control: SELECT_SPEC,
            },
          ],
        },
        { go: true, chan: 'acme' },
      ),
    ).toBe('Go: Post it · Channel: Acme channel');
    expect(
      describeElicitationAnswer(
        { kind: 'file', accept: [], maxBytes: 1000, multiple: false },
        { attachmentId: 'a1', fileName: 'brief.pdf', contentType: 'application/pdf', byteSize: 12 },
      ),
    ).toBe('brief.pdf');
  });
});

describe('withdrawal', () => {
  it('cancels a pending question once and reports the second attempt honestly', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture);

    expect((await cancelElicitation(raised.elicitation.id))?.status).toBe('canceled');
    expect(await cancelElicitation(raised.elicitation.id)).toBeNull();
  });
});

describe('notification delivery is reported, never assumed', () => {
  it('says the deployment has no push identity rather than reporting a delivery', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture, { timeSensitive: true });

    // No VAPID identity is configured in the test environment, and that is reported as its own
    // reason — never as a successful send, and never confused with "you have no browser".
    expect(raised.notified.delivered).toBe(0);
    expect(raised.notified.skipped).toBe('not_configured');
  });

  it('says why nothing was sent when the person has no subscription', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(
      fixture,
      { timeSensitive: true },
      {
        notify: {
          sender: {
            send: async () => {
              throw new Error('the sender must never be reached with no subscription');
            },
          },
        },
      },
    );

    expect(raised.notified.delivered).toBe(0);
    expect(raised.notified.skipped).toBe('no_subscription');
  });

  it('sends the question’s own options as notification actions', async () => {
    const fixture = await seed({ withTask: true });
    await db.insert(schema.contactPoint).values({
      userId: fixture.ownerUserId,
      type: 'push_token',
      value: JSON.stringify({
        endpoint: 'https://push.example/ep/A',
        expirationTime: null,
        keys: { p256dh: 'x'.repeat(88), auth: 'y'.repeat(22) },
      }),
      valueNormalized: 'https://push.example/ep/A',
      valueMasked: 'push.example/…ep/A',
      status: 'active',
    });
    const sent: { title: string; actions: readonly { title: string }[] }[] = [];
    const raised = await raise(
      fixture,
      { timeSensitive: true },
      {
        notify: {
          sender: {
            send: async (_subscription, message) => {
              sent.push({ title: message.title, actions: message.actions });
              return { endpoint: 'https://push.example/ep/A', sentAt: 'now', status: 201 };
            },
          },
        },
      },
    );

    expect(raised.notified).toMatchObject({ delivered: 1, skipped: null });
    expect(sent[0]?.title).toBe('Post the sprint update to the Acme project channel');
    expect(sent[0]?.actions.map((action) => action.title)).toEqual(['Post it', 'Hold off']);
  });

  it('never notifies a question that is not time-sensitive', async () => {
    const fixture = await seed({ withTask: true });
    const raised = await raise(fixture);

    expect(raised.notified.skipped).toBe('not_time_sensitive');
  });

  it('disables a subscription the push service reports gone', async () => {
    const fixture = await seed({ withTask: true });
    const [point] = await db
      .insert(schema.contactPoint)
      .values({
        userId: fixture.ownerUserId,
        type: 'push_token',
        value: JSON.stringify({
          endpoint: 'https://push.example/ep/B',
          expirationTime: null,
          keys: { p256dh: 'x'.repeat(88), auth: 'y'.repeat(22) },
        }),
        valueNormalized: 'https://push.example/ep/B',
        valueMasked: 'push.example/…ep/B',
        status: 'active',
      })
      .returning({ id: schema.contactPoint.id });
    const raised = await raise(fixture, { timeSensitive: true });

    const { WebPushSendError } = await import('@docket/notifications/webpush');
    const result = await notifyElicitation(raised.elicitation, 'Weekly sprint update', {
      sender: {
        send: async () => {
          throw new WebPushSendError('gone', 410);
        },
      },
    });

    expect(result).toMatchObject({ delivered: 0, pruned: 1, failed: 0 });
    const [row] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, assertDefined(point).id));
    expect(row?.status).toBe('disabled');
  });
});
