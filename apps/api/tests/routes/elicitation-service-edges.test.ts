/**
 * `@docket/api` — coverage for the elicitation service's less-traveled branches.
 *
 * @remarks
 * `elicitation.test.ts` proves the product contract (a question is typed, belongs to work, ends,
 * and knows whether it is live). This file fills in the edges that contract exercise doesn't
 * reach on its own: every `ensureElicitationTask` fallback and failure, every branch of the
 * model's flat tool-input normalizer, every answer-rendering shape, and the transactional guard
 * that stops two answers to the same question.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ElicitationRequest } from '@docket/types';

import type * as EventEmitModule from '../../src/routes/event-emit';
import type {
  answerElicitation as AnswerElicitation,
  describeElicitationAnswer as DescribeElicitationAnswer,
  elicitationRequestFromToolInput as ElicitationRequestFromToolInput,
  elicitationsForSessions as ElicitationsForSessions,
  elicitationTaskHref as ElicitationTaskHref,
  ensureElicitationTask as EnsureElicitationTask,
  materializeElicitations as MaterializeElicitations,
  raiseElicitation as RaiseElicitation,
  sweepElicitations as SweepElicitations,
} from '../../src/services/elicitation-service';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let eventEmit!: typeof EventEmitModule;
let ensureElicitationTask!: typeof EnsureElicitationTask;
let raiseElicitation!: typeof RaiseElicitation;
let materializeElicitations!: typeof MaterializeElicitations;
let answerElicitation!: typeof AnswerElicitation;
let sweepElicitations!: typeof SweepElicitations;
let elicitationRequestFromToolInput!: typeof ElicitationRequestFromToolInput;
let describeElicitationAnswer!: typeof DescribeElicitationAnswer;
let elicitationsForSessions!: typeof ElicitationsForSessions;
let elicitationTaskHref!: typeof ElicitationTaskHref;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  eventEmit = await import('../../src/routes/event-emit');
  ({
    ensureElicitationTask,
    raiseElicitation,
    materializeElicitations,
    answerElicitation,
    sweepElicitations,
    elicitationRequestFromToolInput,
    describeElicitationAnswer,
    elicitationsForSessions,
    elicitationTaskHref,
  } = await import('../../src/services/elicitation-service'));
});

/** The one row a query/insert was expected to produce. */
function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('expected at least one row, got none');
  return row;
}

interface Workspace {
  readonly orgId: string;
  readonly teamId: string;
  readonly ownerUserId: string;
  readonly ownerActorId: string;
  readonly taskId: string;
}

/** Seed a workspace with a team, an owning actor, and a task — the happy-path landing spot. */
async function seedWorkspace(): Promise<Workspace> {
  const slug = `elc-edge-${Math.random().toString(36).slice(2, 10)}`;
  const org = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  const statusId = await seedStatuses(db, schema, org.id);
  const owner = one(
    await db
      .insert(schema.user)
      .values({ name: 'Owner', email: `${slug}@example.com` })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.hub).values({ userId: owner.id });
  const ownerActor = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: org.id, kind: 'human', displayName: 'Owner', userId: owner.id })
      .returning({ id: schema.actor.id }),
  );
  const team = one(
    await db
      .insert(schema.team)
      .values({ organizationId: org.id, name: 'Core', key: `E${slug.slice(-4)}` })
      .returning({ id: schema.team.id }),
  );
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: org.id,
        teamId: team.id,
        title: 'Existing work',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        createdBy: ownerActor.id,
      })
      .returning({ id: schema.task.id }),
  );
  return {
    orgId: org.id,
    teamId: team.id,
    ownerUserId: owner.id,
    ownerActorId: ownerActor.id,
    taskId: task.id,
  };
}

/** Insert one bare Athena session row, defaulting to a fresh chat with no task/parent/context. */
async function seedSession(
  overrides: Partial<typeof schema.agentSession.$inferInsert> = {},
): Promise<typeof schema.agentSession.$inferSelect> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        kind: 'chat',
        trigger: 'delegation',
        status: 'awaiting_input',
        ...overrides,
      })
      .returning(),
  );
}

/**
 * Insert a `registered_agent` session — the *only* shape the schema allows with no
 * `ownerUserId` (its check constraint requires the opposite pairing from an `athena` session:
 * an organization and an agent, never an owning person).
 */
async function seedRegisteredAgentSession(
  overrides: Partial<typeof schema.agentSession.$inferInsert> = {},
): Promise<typeof schema.agentSession.$inferSelect> {
  const ws = await seedWorkspace();
  const agentActor = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: ws.orgId, kind: 'agent', displayName: 'Registered' })
      .returning({ id: schema.actor.id }),
  );
  const agent = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: ws.orgId, actorId: agentActor.id })
      .returning({ id: schema.agent.id }),
  );
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'registered_agent',
        organizationId: ws.orgId,
        agentId: agent.id,
        kind: 'chat',
        trigger: 'delegation',
        status: 'awaiting_input',
        ...overrides,
      })
      .returning(),
  );
}

const CONFIRM_REQUEST: ElicitationRequest = {
  question: 'Proceed?',
  actionSummary: 'Do the thing',
  spec: { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' },
  timeoutPolicy: 'ambiguous',
  autoResolveValue: null,
  autoResolveReason: null,
  timeSensitive: false,
};

describe('ensureElicitationTask', () => {
  it('reuses the session’s own task without touching the workspace resolver', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const home = await ensureElicitationTask(session, 'Do it', 'Should I?');
    expect(home).toEqual({ taskId: ws.taskId, organizationId: ws.orgId });
  });

  it('refuses a task pointer to work that no longer exists', async () => {
    const ws = await seedWorkspace();
    // `agent_session.task_id` is FK `ON DELETE SET NULL`, so a real delete can't leave a
    // dangling pointer to assert on — this proves ensureElicitationTask's own defense
    // (`taskHome`'s re-read) rather than relying on that column ever going stale in practice.
    const session = {
      ...(await seedSession({ ownerUserId: ws.ownerUserId })),
      taskId: 'task_gone',
    };
    await expect(ensureElicitationTask(session, 'Do it', 'Should I?')).rejects.toThrow(
      'That work no longer exists.',
    );
  });

  it('inherits the parent session’s task and stamps it onto the child', async () => {
    const ws = await seedWorkspace();
    const parent = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const child = await seedSession({ ownerUserId: ws.ownerUserId, parentSessionId: parent.id });
    const home = await ensureElicitationTask(child, 'Do it', 'Should I?');
    expect(home).toEqual({ taskId: ws.taskId, organizationId: ws.orgId });
    const [reloaded] = await db
      .select({ taskId: schema.agentSession.taskId })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, child.id));
    expect(reloaded?.taskId).toBe(ws.taskId);
  });

  it('falls through to creating new work when the parent session has no task either', async () => {
    const ws = await seedWorkspace();
    const parent = await seedSession({ ownerUserId: ws.ownerUserId });
    const child = await seedSession({
      ownerUserId: ws.ownerUserId,
      parentSessionId: parent.id,
      contextOrganizationId: ws.orgId,
    });
    const home = await ensureElicitationTask(child, 'File a new task', 'Should I?');
    expect(home.organizationId).toBe(ws.orgId);
    expect(home.taskId).not.toBe(ws.taskId);
    const [created] = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.id, home.taskId));
    expect(created?.title).toBe('File a new task');
  });

  it('falls back to the owner’s personal workspace when the conversation has no focus', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId });
    const home = await ensureElicitationTask(session, 'Personal work', 'Should I?');
    expect(home.organizationId).toBe(ws.orgId);
  });

  it('refuses a contextless question from an account with no active membership anywhere', async () => {
    const orphan = one(
      await db
        .insert(schema.user)
        .values({ name: 'Orphan', email: `orphan-${Math.random().toString(36).slice(2)}@x.test` })
        .returning({ id: schema.user.id }),
    );
    const session = await seedSession({ ownerUserId: orphan.id });
    await expect(ensureElicitationTask(session, 'Do it', 'Should I?')).rejects.toThrow(
      'This work has no workspace to track a task in yet.',
    );
  });

  it('refuses a question with no owning person, even from within a real workspace', async () => {
    // A `registered_agent` session always belongs to a real organization (never `null`) — so
    // this proves the guard is really keyed on "no owner", not merely "no workspace": the
    // workspace is right there, and the question is still refused because nobody can be asked.
    const session = await seedRegisteredAgentSession();
    await expect(ensureElicitationTask(session, 'Do it', 'Should I?')).rejects.toThrow(
      'This work has no workspace to track a task in yet.',
    );
  });

  it('refuses a fully contextless question — no focus, no parent task, no owner at all', async () => {
    // No real session can have both a null owner and a null organization at once (the
    // athena/registered_agent shapes each forbid one half of that) — this exercises
    // ensureElicitationTask's own fallback chain directly, in isolation from either caller's
    // guarantees, the same way the two branches above each isolate one half of it.
    const ws = await seedWorkspace();
    const bare = await seedSession({ ownerUserId: ws.ownerUserId });
    const contextless = { ...bare, ownerUserId: null, contextOrganizationId: null };
    await expect(ensureElicitationTask(contextless, 'Do it', 'Should I?')).rejects.toThrow(
      'This work has no workspace to track a task in yet.',
    );
  });

  it('refuses when the owner has lost their membership in the focused workspace', async () => {
    const ws = await seedWorkspace();
    const strandedUser = one(
      await db
        .insert(schema.user)
        .values({
          name: 'Stranded',
          email: `stranded-${Math.random().toString(36).slice(2)}@x.test`,
        })
        .returning({ id: schema.user.id }),
    );
    const session = await seedSession({
      ownerUserId: strandedUser.id,
      contextOrganizationId: ws.orgId,
    });
    await expect(ensureElicitationTask(session, 'Do it', 'Should I?')).rejects.toThrow(
      'This work has no workspace to track a task in yet.',
    );
  });

  it('refuses a workspace with no team to land the new work in', async () => {
    const slug = `elc-noteam-${Math.random().toString(36).slice(2, 10)}`;
    const org = one(
      await db
        .insert(schema.organization)
        .values({ name: slug, slug, lifecycleState: 'active' })
        .returning({ id: schema.organization.id }),
    );
    const owner = one(
      await db
        .insert(schema.user)
        .values({ name: 'Teamless owner', email: `${slug}@example.com` })
        .returning({ id: schema.user.id }),
    );
    await db.insert(schema.hub).values({ userId: owner.id });
    await db.insert(schema.actor).values({
      organizationId: org.id,
      kind: 'human',
      displayName: 'Teamless owner',
      userId: owner.id,
    });
    const session = await seedSession({ ownerUserId: owner.id, contextOrganizationId: org.id });
    await expect(ensureElicitationTask(session, 'Do it', 'Should I?')).rejects.toThrow(
      'This workspace has no team to file work into yet.',
    );
  });
});

describe('raiseElicitation — session and ownership guards', () => {
  it('refuses to raise against a session that does not exist', async () => {
    await expect(
      raiseElicitation({ sessionId: 'session_missing', request: CONFIRM_REQUEST }),
    ).rejects.toThrow('Session not found');
  });

  it('refuses to raise against work with no owner to ask', async () => {
    const session = await seedRegisteredAgentSession();
    await expect(
      raiseElicitation({ sessionId: session.id, request: CONFIRM_REQUEST }),
    ).rejects.toThrow('Only owner-attributed work can ask its owner.');
  });
});

describe('elicitationRequestFromToolInput / specFromToolInput', () => {
  it('normalizes input that is not an object at all', () => {
    const request = elicitationRequestFromToolInput(null);
    expect(request.question).toBe('I need your input to continue.');
    expect(request.actionSummary).toBe(request.question);
    expect(request.spec).toMatchObject({ kind: 'text' });
  });

  it('falls back the action summary to the question when none is supplied', () => {
    const request = elicitationRequestFromToolInput({ question: 'Ship it?' });
    expect(request.actionSummary).toBe('Ship it?');
  });

  it('normalizes a confirm control, defaulting unlabeled buttons', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Go?',
      responseType: 'confirm',
    });
    expect(request.spec).toEqual({
      kind: 'confirm',
      confirmLabel: 'Yes, do it',
      declineLabel: 'No, stop',
    });
  });

  it('normalizes a confirm control with explicit labels', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Go?',
      responseType: 'confirm',
      confirmLabel: 'Ship',
      declineLabel: 'Hold',
    });
    expect(request.spec).toEqual({ kind: 'confirm', confirmLabel: 'Ship', declineLabel: 'Hold' });
  });

  it('reads select options given as bare strings', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Pick',
      responseType: 'select',
      options: ['acme', 'ops'],
    });
    expect(request.spec).toEqual({
      kind: 'select',
      multiple: false,
      options: [
        { value: 'acme', label: 'acme', description: null },
        { value: 'ops', label: 'ops', description: null },
      ],
    });
  });

  it('drops select options with no usable value and defaults an unlabeled one to its value', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Pick',
      responseType: 'select',
      multiple: true,
      options: [null, 42, {}, { label: 'Ignored — no value' }, { value: 'ops' }],
    });
    expect(request.spec).toEqual({
      kind: 'select',
      multiple: true,
      options: [{ value: 'ops', label: 'ops', description: null }],
    });
  });

  it('keeps a select option’s own label and description when both are given', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Pick',
      responseType: 'select',
      options: [{ value: 'ops', label: 'Ops channel', description: 'The on-call channel' }],
    });
    expect(request.spec).toEqual({
      kind: 'select',
      multiple: false,
      options: [{ value: 'ops', label: 'Ops channel', description: 'The on-call channel' }],
    });
  });

  it('degrades a select whose options are not a list at all to a plain text question', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Pick',
      responseType: 'select',
      options: 'acme',
    });
    expect(request.spec.kind).toBe('text');
  });

  it('normalizes a datetime control with an unrecognized precision and no timezone', () => {
    const request = elicitationRequestFromToolInput({
      question: 'When?',
      responseType: 'datetime',
      precision: 'century',
      min: '2026-01-01',
      max: '2026-12-31',
    });
    expect(request.spec).toEqual({
      kind: 'datetime',
      precision: 'datetime',
      timeZone: 'UTC',
      min: '2026-01-01',
      max: '2026-12-31',
    });
  });

  it('normalizes a file control with no accept list, defaulting to single-file', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Attach it',
      responseType: 'file',
    });
    expect(request.spec).toEqual({
      kind: 'file',
      accept: [],
      maxBytes: 26_214_400,
      multiple: false,
    });
  });

  it('degrades a form with no usable fields to a plain text question', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Tell me',
      responseType: 'form',
      fields: [null, { label: 'No key' }, 'nope'],
    });
    expect(request.spec.kind).toBe('text');
  });

  it('degrades a form whose fields are not a list at all to a plain text question', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Tell me',
      responseType: 'form',
      fields: 'note',
    });
    expect(request.spec.kind).toBe('text');
  });

  it('keeps a form field’s own description when one is given', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Tell me',
      responseType: 'form',
      fields: [{ key: 'note', label: 'Note', description: 'Anything helpful' }],
    });
    expect(request.spec).toMatchObject({
      kind: 'form',
      fields: [{ key: 'note', label: 'Note', description: 'Anything helpful' }],
    });
  });

  it('defaults an unlabeled form field’s label to its key', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Tell me',
      responseType: 'form',
      fields: [{ key: 'note' }],
    });
    expect(request.spec).toMatchObject({
      kind: 'form',
      fields: [{ key: 'note', label: 'note', required: true, control: { kind: 'text' } }],
    });
  });

  it('normalizes a plain text control, defaulting to single-line with no placeholder', () => {
    const request = elicitationRequestFromToolInput({ question: 'Say more' });
    expect(request.spec).toEqual({
      kind: 'text',
      multiline: false,
      minLength: null,
      maxLength: null,
      placeholder: null,
    });
  });

  it('keeps a text control’s own placeholder when the model supplies one', () => {
    const request = elicitationRequestFromToolInput({
      question: 'Say more',
      multiline: true,
      placeholder: 'e.g. a link to the doc',
    });
    expect(request.spec).toEqual({
      kind: 'text',
      multiline: true,
      minLength: null,
      maxLength: null,
      placeholder: 'e.g. a link to the doc',
    });
  });
});

describe('materializeElicitations — session guard', () => {
  it('does nothing for a session that does not exist', async () => {
    expect(await materializeElicitations('session_missing')).toEqual([]);
  });
});

describe('materializeElicitations — derivable normalization', () => {
  it('materializes a derivable question whose default satisfies its own spec', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    await db.insert(schema.sessionActivity).values({
      sessionId: session.id,
      type: 'elicitation',
      body: {
        text: 'Post now?',
        responseType: 'confirm',
        timeoutPolicy: 'derivable',
        autoResolveValue: true,
        autoResolveReason: 'Confirmations default to yes when unattended.',
      },
    });
    const [materialized] = await materializeElicitations(session.id);
    expect(materialized?.elicitation.timeoutPolicy).toBe('derivable');
  });

  it('downgrades a materialized derivable claim whose default fails its own spec', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    await db.insert(schema.sessionActivity).values({
      sessionId: session.id,
      type: 'elicitation',
      body: {
        text: 'Post now?',
        responseType: 'confirm',
        timeoutPolicy: 'derivable',
        autoResolveValue: 'not-a-boolean',
      },
    });
    const [materialized] = await materializeElicitations(session.id);
    expect(materialized?.elicitation.timeoutPolicy).toBe('ambiguous');
  });

  it('leaves a non-derivable materialized question’s policy untouched', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    await db.insert(schema.sessionActivity).values({
      sessionId: session.id,
      type: 'elicitation',
      body: { text: 'Post now?', responseType: 'confirm', timeoutPolicy: 'destructive' },
    });
    const [materialized] = await materializeElicitations(session.id);
    expect(materialized?.elicitation.timeoutPolicy).toBe('destructive');
    expect(materialized?.elicitation.toolUseId).toBeNull();
  });
});

describe('answer rendering — every spec shape', () => {
  it('renders a confirmed "yes" and a rendered number', () => {
    expect(
      describeElicitationAnswer(
        { kind: 'confirm', confirmLabel: 'Ship', declineLabel: 'Hold' },
        true,
      ),
    ).toBe('Ship');
    expect(
      describeElicitationAnswer({ kind: 'number', integer: false, min: null, max: null }, 42),
    ).toBe('42');
  });

  it('renders a multi-select answer by joining each chosen label', () => {
    const spec = {
      kind: 'select' as const,
      multiple: true,
      options: [
        { value: 'acme', label: 'Acme channel', description: null },
        { value: 'ops', label: 'Ops channel', description: null },
      ],
    };
    expect(describeElicitationAnswer(spec, ['acme', 'ops'])).toBe('Acme channel, Ops channel');
  });

  it('renders an option value verbatim when it does not match any declared option', () => {
    const spec = {
      kind: 'select' as const,
      multiple: false,
      options: [{ value: 'acme', label: 'Acme channel', description: null }],
    };
    expect(describeElicitationAnswer(spec, 'unknown-value')).toBe('unknown-value');
  });

  it('renders a text and a datetime answer as their raw string', () => {
    const textSpec = {
      kind: 'text' as const,
      multiline: false,
      minLength: null,
      maxLength: null,
      placeholder: null,
    };
    expect(describeElicitationAnswer(textSpec, 'Hello there')).toBe('Hello there');
    const dtSpec = {
      kind: 'datetime' as const,
      precision: 'date' as const,
      timeZone: 'UTC',
      min: null,
      max: null,
    };
    expect(describeElicitationAnswer(dtSpec, '2026-08-02')).toBe('2026-08-02');
  });

  it('renders multiple files and falls back to "a file" for an unnamed one', () => {
    const spec = { kind: 'file' as const, accept: [], maxBytes: 1000, multiple: true };
    expect(
      describeElicitationAnswer(spec, [
        { attachmentId: 'a1', fileName: 'brief.pdf', contentType: 'application/pdf', byteSize: 1 },
        'not-a-file-object',
      ]),
    ).toBe('brief.pdf, a file');
  });

  it('renders an empty list as "nothing" and a populated list by describing each item', () => {
    const itemSpec = {
      kind: 'text' as const,
      multiline: false,
      minLength: null,
      maxLength: null,
      placeholder: null,
    };
    const listSpec = { kind: 'list' as const, item: itemSpec, minItems: null, maxItems: null };
    expect(describeElicitationAnswer(listSpec, [])).toBe('nothing');
    expect(describeElicitationAnswer(listSpec, ['a', 'b'])).toBe('a, b');
  });

  it('renders a matched discriminated-union arm with its fields, and an unmatched tag as raw text', () => {
    const variantSpec = {
      kind: 'variant' as const,
      discriminator: 'via',
      variants: [
        {
          value: 'email',
          label: 'By email',
          fields: [
            {
              key: 'address',
              label: 'Address',
              description: null,
              required: true,
              control: {
                kind: 'text' as const,
                multiline: false,
                minLength: null,
                maxLength: null,
                placeholder: null,
              },
            },
          ],
        },
      ],
    };
    expect(describeElicitationAnswer(variantSpec, { via: 'email', address: 'a@b.com' })).toBe(
      'By email — Address: a@b.com',
    );
    expect(describeElicitationAnswer(variantSpec, { via: 'carrier_pigeon' })).toBe(
      'carrier_pigeon',
    );
  });

  it('renders a matched arm with no fields as just its label', () => {
    const variantSpec = {
      kind: 'variant' as const,
      discriminator: 'via',
      variants: [{ value: 'skip', label: 'Skip entirely', fields: [] }],
    };
    expect(describeElicitationAnswer(variantSpec, { via: 'skip' })).toBe('Skip entirely');
  });

  it('treats a nullish form answer as empty rather than throwing', () => {
    const spec = {
      kind: 'form' as const,
      fields: [
        {
          key: 'note',
          label: 'Note',
          description: null,
          required: false,
          control: {
            kind: 'text' as const,
            multiline: false,
            minLength: null,
            maxLength: null,
            placeholder: null,
          },
        },
      ],
    };
    expect(describeElicitationAnswer(spec, null)).toBe('Note: undefined');
  });

  it('treats a non-array list answer as empty', () => {
    const itemSpec = {
      kind: 'text' as const,
      multiline: false,
      minLength: null,
      maxLength: null,
      placeholder: null,
    };
    const listSpec = { kind: 'list' as const, item: itemSpec, minItems: null, maxItems: null };
    expect(describeElicitationAnswer(listSpec, undefined)).toBe('nothing');
  });

  it('renders an empty discriminator tag verbatim for a nullish variant answer', () => {
    const variantSpec = {
      kind: 'variant' as const,
      discriminator: 'via',
      variants: [{ value: 'email', label: 'By email', fields: [] }],
    };
    expect(describeElicitationAnswer(variantSpec, null)).toBe('');
  });
});

describe('answerElicitation — identity and concurrency guards', () => {
  it('hides a question that does not exist', async () => {
    await expect(
      answerElicitation({ elicitationId: 'elicitation_missing', value: true }),
    ).rejects.toThrow('Question not found');
  });

  it('lets exactly one of two concurrent answers to the same question win', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const raised = await raiseElicitation({ sessionId: session.id, request: CONFIRM_REQUEST });

    const settled = await Promise.allSettled([
      answerElicitation({
        elicitationId: raised.elicitation.id,
        userId: ws.ownerUserId,
        value: true,
      }),
      answerElicitation({
        elicitationId: raised.elicitation.id,
        userId: ws.ownerUserId,
        value: true,
      }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled');
    const rejected = settled.filter((entry) => entry.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      message: 'This question is already settled.',
    });
    const [row] = await db
      .select({ status: schema.agentElicitation.status })
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.status).toBe('answered');
  });

  it('settles a personal (workspace-less) question without emitting a workspace event', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const raised = await raiseElicitation({ sessionId: session.id, request: CONFIRM_REQUEST });
    await db
      .update(schema.agentElicitation)
      .set({ organizationId: null })
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    const emitSpy = vi.spyOn(eventEmit, 'emitElicitationEvent');
    emitSpy.mockClear();

    const result = await answerElicitation({
      elicitationId: raised.elicitation.id,
      userId: ws.ownerUserId,
      value: true,
    });

    expect(result.ok).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();
    emitSpy.mockRestore();
  });

  it('records an Athena auto-resolution with no trailing reasoning when none was given', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const raised = await raiseElicitation({ sessionId: session.id, request: CONFIRM_REQUEST });

    await answerElicitation({
      elicitationId: raised.elicitation.id,
      source: 'athena',
      value: true,
    });

    const [response] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, session.id),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(response?.body.text).toBe('Yes');
  });
});

describe('sweepElicitations — a failed auto-resolve still parks', () => {
  it('parks a question whose auto-resolve raced a concurrent settlement instead of crashing the sweep', async () => {
    const ws = await seedWorkspace();
    const earlySession = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const lateSession = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const past = new Date(Date.now() - 60_000);
    const derivableRequest: ElicitationRequest = {
      ...CONFIRM_REQUEST,
      timeoutPolicy: 'derivable',
      autoResolveValue: true,
      autoResolveReason: 'Defaults to yes.',
    };
    const early = await raiseElicitation({
      sessionId: earlySession.id,
      request: derivableRequest,
      now: past,
      ttlMs: 60_000 * 60,
    });
    const late = await raiseElicitation({
      sessionId: lateSession.id,
      request: derivableRequest,
      now: past,
      ttlMs: 60_000 * 60,
    });
    await db
      .update(schema.agentElicitation)
      .set({ expiresAt: new Date(past.getTime() + 1) })
      .where(eq(schema.agentElicitation.id, early.elicitation.id));
    await db
      .update(schema.agentElicitation)
      .set({ expiresAt: new Date(past.getTime() + 2) })
      .where(eq(schema.agentElicitation.id, late.elicitation.id));

    const realEmit = eventEmit.emitElicitationEvent;
    const spy = vi.spyOn(eventEmit, 'emitElicitationEvent').mockImplementation(async (input) => {
      if (input.elicitationId === early.elicitation.id) {
        // Simulate the "two tabs" race from the answer-guard test above, but landing strictly
        // between the sweep settling the earlier question and it reaching the later one.
        await db
          .update(schema.agentElicitation)
          .set({ status: 'answered', resolver: 'user', answer: true, settledAt: new Date() })
          .where(eq(schema.agentElicitation.id, late.elicitation.id));
      }
      return realEmit(input);
    });

    const result = await sweepElicitations(new Date());

    expect(result.autoResolved).toBe(1);
    expect(result.parked).toBe(1);
    const [lateRow] = await db
      .select({ status: schema.agentElicitation.status })
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, late.elicitation.id));
    // Still `answered` (from the simulated race), never overwritten to `parked` — proving the
    // sweep's own park attempt was a no-op rather than clobbering a settlement it lost.
    expect(lateRow?.status).toBe('answered');
    spy.mockRestore();
  });

  it('parks a personal (workspace-less) question without emitting a workspace event', async () => {
    const ws = await seedWorkspace();
    const session = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const raised = await raiseElicitation({
      sessionId: session.id,
      request: CONFIRM_REQUEST,
      now: new Date(Date.now() - 60_000),
      ttlMs: 60_000,
    });
    await db
      .update(schema.agentElicitation)
      .set({ organizationId: null, expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    const emitSpy = vi.spyOn(eventEmit, 'emitElicitationEvent');
    emitSpy.mockClear();

    const result = await sweepElicitations(new Date());

    expect(result.parked).toBe(1);
    expect(emitSpy).not.toHaveBeenCalled();
    const [row] = await db
      .select({ status: schema.agentElicitation.status })
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, raised.elicitation.id));
    expect(row?.status).toBe('parked');
    emitSpy.mockRestore();
  });
});

describe('elicitationTaskHref', () => {
  it('links to the org-scoped task page when a workspace is known', () => {
    expect(elicitationTaskHref('org_1', 'task_1')).toBe('/orgs/org_1/tasks/task_1');
  });

  it('links a workspace-less question to the served personal task list', () => {
    expect(elicitationTaskHref(null, 'task_1')).toBe('/tasks');
  });
});

describe('elicitationsForSessions', () => {
  it('returns nothing for an empty session list without a query round trip', async () => {
    expect(await elicitationsForSessions([])).toEqual([]);
  });

  it('loads every question raised across a set of sessions, each with its task title', async () => {
    const ws = await seedWorkspace();
    const sessionA = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const sessionB = await seedSession({ ownerUserId: ws.ownerUserId, taskId: ws.taskId });
    const raisedA = await raiseElicitation({ sessionId: sessionA.id, request: CONFIRM_REQUEST });
    const raisedB = await raiseElicitation({ sessionId: sessionB.id, request: CONFIRM_REQUEST });

    const found = await elicitationsForSessions([sessionA.id, sessionB.id]);

    expect(new Set(found.map((entry) => entry.row.id))).toEqual(
      new Set([raisedA.elicitation.id, raisedB.elicitation.id]),
    );
    expect(found.every((entry) => entry.taskTitle === 'Existing work')).toBe(true);
  });
});
