/**
 * `@docket/api` — the elicitation service: raising, answering, and expiring typed questions.
 *
 * @remarks
 * Everything a question does that is not display lives here, and nothing that is display does.
 * The four invariants this module owns, each of which the surrounding code used to leave to
 * convention:
 *
 * 1. **A question is typed.** An answer is validated against the raiser's declared spec before
 *    anyone else sees it. A refusal is per-field data and leaves the question open, so the person's
 *    other fields survive; an acceptance is handed to the waiting agent as parsed typed data, not
 *    as text appended to a transcript.
 * 2. **A question belongs to work.** {@link ensureElicitationTask} finds or creates the task the
 *    question exists to implement, because the column is `NOT NULL` and there is no other way in.
 * 3. **A question ends.** {@link sweepElicitations} settles everything past its deadline. Only a
 *    `derivable` policy lets Athena answer in the person's place, with her reasoning stated in the
 *    transcript; `ambiguous` and `destructive` park the work and say so, mutating nothing.
 * 4. **A question knows whether it is live.** Presence is recorded by the surface and read at raise
 *    time, so "the user is easily accessible" is a fact about the moment the question was asked,
 *    not a guess made later by whoever happens to read the row.
 */
import {
  actor,
  agentElicitation,
  agentSession,
  athenaPresence,
  db,
  sessionActivity,
  task,
  type Database,
} from '@docket/db';
import {
  ELICITATION_DEFAULT_TTL_MS,
  ELICITATION_MAX_TTL_MS,
  ELICITATION_MIN_TTL_MS,
  ElicitationRequestSchema,
  parseElicitationAnswer,
  type ElicitationField,
  type ElicitationFieldError,
  type ElicitationRequest,
  type ElicitationSpec,
} from '@docket/athena/elicitation';
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import {
  notifyElicitation,
  type ElicitationNotifyResult,
  type NotifyElicitationDeps,
} from './elicitation-notify';
import { emitElicitationEvent } from '../routes/event-emit';
import { ownerActorIn } from '../routes/agent-dispatch';
import { resolveLandingTarget } from '../lib/task-landing';
import { ConflictError, NotFoundError } from '../error';

/** One persisted elicitation row. */
export type ElicitationRow = typeof agentElicitation.$inferSelect;
/** One persisted agent session row. */
type SessionRow = typeof agentSession.$inferSelect;

/**
 * How long a focus heartbeat counts for.
 *
 * @remarks
 * Long enough that reading a long answer without touching the keyboard does not make you "absent",
 * short enough that a laptop lid closed two minutes ago does not make a question look live. The
 * surface heartbeats on a shorter cadence than this, so a live session refreshes well before it
 * lapses.
 */
export const ATHENA_PRESENCE_WINDOW_MS = 90_000;

/** The in-app path a person lands on to answer one question in the context of its task. */
export function elicitationPermalink(elicitationId: string): string {
  return `/athena?elicitation=${encodeURIComponent(elicitationId)}`;
}

/** The in-app path of the task a question exists to implement. */
export function elicitationTaskHref(organizationId: string | null, taskId: string): string {
  return organizationId ? `/orgs/${organizationId}/tasks/${taskId}` : '/tasks';
}

/* -------------------------------------------------------------------------------------------- */
/* Presence                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Record that a person is (or is no longer) watching Athena.
 *
 * @remarks
 * One upserted row per person, never an append-only log: this is a current state used to decide
 * whether one question is live, and keeping a history of when someone was at their desk would be
 * surveillance rather than a feature.
 *
 * @param userId - The watching person.
 * @param focused - True while the Athena surface is open AND the document has focus.
 * @param now - The clock; injected so tests can fast-forward.
 */
export async function recordAthenaPresence(
  userId: string,
  focused: boolean,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(athenaPresence)
    .values({ userId, focusedAt: focused ? now : null, seenAt: now })
    .onConflictDoUpdate({
      target: athenaPresence.userId,
      set: { focusedAt: focused ? now : null, seenAt: now, updatedAt: now },
    });
}

/**
 * Whether a question raised right now would be treated as live for this person.
 *
 * @param userId - The person who would be asked.
 * @param now - The clock; injected so tests can fast-forward.
 * @returns The liveness verdict and the moment it was derived from.
 */
export async function readAthenaPresence(
  userId: string,
  now: Date = new Date(),
): Promise<{ live: boolean; lastSeenAt: Date | null }> {
  const rows = await db
    .select({ focusedAt: athenaPresence.focusedAt })
    .from(athenaPresence)
    .where(eq(athenaPresence.userId, userId))
    .limit(1);
  const focusedAt = rows[0]?.focusedAt ?? null;
  const live =
    focusedAt !== null && now.getTime() - focusedAt.getTime() <= ATHENA_PRESENCE_WINDOW_MS;
  return { live, lastSeenAt: focusedAt };
}

/* -------------------------------------------------------------------------------------------- */
/* Raising                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/** Everything needed to raise one elicitation. */
export interface RaiseElicitationInput {
  /** The session that will block on the answer. */
  readonly sessionId: string;
  /** The typed request, already validated against `ElicitationRequestSchema`. */
  readonly request: ElicitationRequest;
  /** The model's `tool_use` id, when the question came from a tool call. */
  readonly toolUseId?: string | null;
  /** How long to wait before the timeout policy applies. */
  readonly ttlMs?: number;
  /** The clock; injected so tests can fast-forward. */
  readonly now?: Date;
  /** Push-sender injection, so a test can assert on delivery without a push service. */
  readonly notify?: NotifyElicitationDeps;
}

/** What raising one elicitation produced. */
export interface RaiseElicitationResult {
  /** The persisted question. */
  readonly elicitation: ElicitationRow;
  /** The transcript row a person reads. */
  readonly activityId: string;
  /** The task the question was attached to, created if the session had none. */
  readonly taskId: string;
  /** Whether the asked person was watching when it was raised. */
  readonly live: boolean;
  /**
   * What the notification attempt actually did.
   *
   * @remarks
   * Reported rather than swallowed: "we raised a question and told you" and "we raised a question
   * and could not tell you" are different outcomes, and a caller that cannot tell them apart will
   * eventually claim the second was the first.
   */
  readonly notified: ElicitationNotifyResult;
}

/** Clamp a requested wait into the range a question is allowed to hold work for. */
function clampTtl(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return ELICITATION_DEFAULT_TTL_MS;
  return Math.min(Math.max(ttlMs, ELICITATION_MIN_TTL_MS), ELICITATION_MAX_TTL_MS);
}

/** The workspace a session's question is attributed to, if any. */
function sessionOrganizationId(session: SessionRow): string | null {
  return session.organizationId ?? session.contextOrganizationId ?? null;
}

/**
 * The workspace a person's own work lands in when their conversation has no focus.
 *
 * @remarks
 * Every Docket person has at least one — a personal workspace is created during onboarding — so
 * this is a fallback, not a guess. Returns null only for an account with no active membership
 * anywhere, in which case the caller refuses rather than inventing a home for the work.
 */
async function personalWorkspaceOf(ownerUserId: string): Promise<string | null> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, ownerUserId), eq(actor.kind, 'human'), eq(actor.status, 'active')))
    .orderBy(asc(actor.createdAt))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/**
 * Find or create the task one question exists to implement.
 *
 * @remarks
 * Walks the session's own task, then its parent session's — a spawned agent asking a question is
 * asking about the work its dispatcher created — and only creates a new task when neither exists.
 * The created task is titled with the *action* being authorized rather than the question, because
 * the task is the work, and "Which channel?" is not work.
 *
 * @param session - The asking session.
 * @param actionSummary - The action the answer authorizes; becomes the task title if one is made.
 * @param question - The question, kept as the created task's description.
 * @returns The task id the elicitation will reference.
 * @throws {ConflictError} When there is no workspace to create a task in.
 */
export async function ensureElicitationTask(
  session: SessionRow,
  actionSummary: string,
  question: string,
): Promise<ElicitationTaskHome> {
  if (session.taskId) return taskHome(session.taskId);

  if (session.parentSessionId) {
    const parents = await db
      .select({ taskId: agentSession.taskId })
      .from(agentSession)
      .where(eq(agentSession.id, session.parentSessionId))
      .limit(1);
    const parentTaskId = parents[0]?.taskId;
    if (parentTaskId) {
      await db
        .update(agentSession)
        .set({ taskId: parentTaskId })
        .where(eq(agentSession.id, session.id));
      return taskHome(parentTaskId);
    }
  }

  const ownerUserId = session.ownerUserId;
  // A conversation opened with no workspace focus still has to be able to file the work a question
  // implements, so fall back to the person's own workspace. Without this, the very first question
  // in a fresh conversation would be refused for a reason that is not the person's problem.
  const organizationId =
    sessionOrganizationId(session) ?? (ownerUserId ? await personalWorkspaceOf(ownerUserId) : null);
  if (!organizationId || !ownerUserId) {
    throw new ConflictError('This work has no workspace to track a task in yet.');
  }
  const actorId = await ownerActorIn(ownerUserId, organizationId);
  if (!actorId) throw new ConflictError('This work has no workspace to track a task in yet.');
  const landing = await resolveLandingTarget(organizationId, actorId);
  if (!landing) throw new ConflictError('This workspace has no team to file work into yet.');

  const [created] = await db
    .insert(task)
    .values({
      organizationId,
      title: actionSummary.slice(0, 120),
      description: question,
      teamId: landing.teamId,
      statusId: landing.statusId,
      state: landing.state,
      assigneeId: landing.assigneeId,
      cycleId: landing.cycleId,
      source: 'native',
      createdBy: actorId,
    })
    .returning({ id: task.id });
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('elicitation task insert returned no row');

  // The session now points at the task its question implements. It deliberately does NOT upgrade
  // `work_linkage` to `'task'`: that claim belongs to the dispatcher alone (asserted by
  // `tests/agent/athena-architecture.test.ts`), and a question is not an admission of work — the
  // task exists so the answer has somewhere to live, not because this session was dispatched.
  await db.update(agentSession).set({ taskId: created.id }).where(eq(agentSession.id, session.id));
  return { taskId: created.id, organizationId };
}

/** Where one question's work is tracked: the task, and the workspace that task lives in. */
export interface ElicitationTaskHome {
  /** The task the question exists to implement. */
  readonly taskId: string;
  /** The workspace that task belongs to; never null, because a task cannot exist outside one. */
  readonly organizationId: string;
}

/** Read the workspace an existing task lives in. */
async function taskHome(taskId: string): Promise<ElicitationTaskHome> {
  const rows = await db
    .select({ organizationId: task.organizationId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) throw new ConflictError('That work no longer exists.');
  return { taskId, organizationId };
}

/** Everything {@link insertElicitationRow} needs; assembled by the two entry points. */
interface InsertElicitationInput {
  readonly session: SessionRow;
  readonly activityId: string;
  readonly askedUserId: string;
  readonly organizationId: string | null;
  readonly taskId: string;
  readonly request: ElicitationRequest;
  readonly timeoutPolicy: ElicitationRequest['timeoutPolicy'];
  readonly derivable: boolean;
  readonly live: boolean;
  readonly expiresAt: Date;
  readonly toolUseId: string | null;
}

/**
 * Write the elicitation row and stamp its id back onto the transcript entry.
 *
 * @remarks
 * Shared by both entry points so the transcript row can never end up without the typed request
 * behind it — that pairing is the only way a reader gets from a line of text to a form.
 */
async function insertElicitationRow(
  tx: Database,
  input: InsertElicitationInput,
): Promise<ElicitationRow> {
  const [row] = await tx
    .insert(agentElicitation)
    .values({
      sessionId: input.session.id,
      activityId: input.activityId,
      organizationId: input.organizationId,
      askedUserId: input.askedUserId,
      taskId: input.taskId,
      toolUseId: input.toolUseId,
      question: input.request.question,
      actionSummary: input.request.actionSummary,
      spec: input.request.spec,
      timeoutPolicy: input.timeoutPolicy,
      timeSensitive: input.request.timeSensitive,
      live: input.live,
      autoResolveValue: input.derivable ? (input.request.autoResolveValue as never) : null,
      autoResolveReason: input.request.autoResolveReason,
      expiresAt: input.expiresAt,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('elicitation insert returned no row');

  await tx
    .update(sessionActivity)
    .set({
      body: {
        text: input.request.question,
        actionSummary: input.request.actionSummary,
        elicitationId: row.id,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
      },
    })
    .where(eq(sessionActivity.id, input.activityId));
  return row;
}

/**
 * Raise one typed question against a session and block it on the answer.
 *
 * @remarks
 * The transcript row and the elicitation row are written in one transaction, so a crash between
 * "the person can see the question" and "the question has a deadline" is not representable. The
 * activity's body carries the elicitation id, which is how a transcript reader finds the typed
 * request behind a line of text.
 *
 * @param input - See {@link RaiseElicitationInput}.
 * @returns The persisted question and what it was attached to.
 * @throws {NotFoundError} When the session does not exist.
 * @throws {ConflictError} When the session cannot be given a task to hang the question on.
 */
export async function raiseElicitation(
  input: RaiseElicitationInput,
): Promise<RaiseElicitationResult> {
  const now = input.now ?? new Date();
  const sessions = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, input.sessionId))
    .limit(1);
  const session = sessions[0];
  if (!session) throw new NotFoundError('Session not found');
  const askedUserId = session.ownerUserId;
  if (!askedUserId) throw new ConflictError('Only owner-attributed work can ask its owner.');

  // The workspace on the row is the one its task lives in, not whatever focus the conversation
  // happened to carry: the task is the durable thing, and the card's link, the file-upload target
  // and the emitted event all have to agree with it.
  const { taskId, organizationId } = await ensureElicitationTask(
    session,
    input.request.actionSummary,
    input.request.question,
  );
  const { live } = await readAthenaPresence(askedUserId, now);
  const expiresAt = new Date(now.getTime() + clampTtl(input.ttlMs));

  // A promised default that does not satisfy its own spec is no default; downgrade rather than
  // let the sweep record an answer the agent could not have used.
  const derivable =
    input.request.timeoutPolicy === 'derivable' &&
    parseElicitationAnswer(input.request.spec, input.request.autoResolveValue).ok;
  const timeoutPolicy = derivable
    ? 'derivable'
    : input.request.timeoutPolicy === 'derivable'
      ? 'ambiguous'
      : input.request.timeoutPolicy;

  const created = await db.transaction(async (tx) => {
    const [activity] = await tx
      .insert(sessionActivity)
      .values({
        sessionId: session.id,
        // `session.executorKind` is always `'athena'` here: the check constraint on
        // `agent_session` pairs `executorKind = 'registered_agent'` with `owner_user_id IS
        // NULL`, and the guard a few lines up already refused any session without an owner.
        /* v8 ignore next -- @preserve defensive: see remark above */
        organizationId: session.executorKind === 'athena' ? null : organizationId,
        type: 'elicitation',
        body: {
          text: input.request.question,
          actionSummary: input.request.actionSummary,
          ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        },
      })
      .returning({ id: sessionActivity.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!activity) throw new Error('elicitation activity insert returned no row');

    return insertElicitationRow(tx, {
      session,
      activityId: activity.id,
      askedUserId,
      organizationId,
      taskId,
      request: input.request,
      timeoutPolicy,
      derivable,
      live,
      expiresAt,
      toolUseId: input.toolUseId ?? null,
    });
  });

  {
    await emitElicitationEvent({
      organizationId,
      kind: 'elicitation_requested',
      sessionId: session.id,
      elicitationId: created.id,
      askedUserId,
      occurredAt: now,
      question: input.request.question,
      expiresAt: expiresAt.toISOString(),
      permalink: elicitationPermalink(created.id),
    });
  }

  const taskTitles = await db
    .select({ title: task.title })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  // `taskId` was just proven to exist by `ensureElicitationTask`, a moment ago in this same
  // function — the `?? actionSummary` fallback only fires if the task was deleted in the
  // instant between that check and this read, a real but not fault-injectably-testable race.
  const notified = await notifyElicitation(
    created,
    /* v8 ignore next -- @preserve defensive: see remark above */
    taskTitles[0]?.title ?? input.request.actionSummary,
    input.notify ?? {},
  );

  return { elicitation: created, activityId: created.activityId, taskId, live, notified };
}

/* -------------------------------------------------------------------------------------------- */
/* Materializing what the model asked                                                            */
/* -------------------------------------------------------------------------------------------- */

/**
 * Build a typed request out of one `ask_user` tool input.
 *
 * @remarks
 * The model writes a flat, JSON-Schema-describable object — it cannot be handed a recursive Zod
 * grammar in a tool definition — and this is where that flat shape becomes a spec. Anything the
 * model leaves out gets the *safe* default, not the convenient one: an unspecified timeout policy
 * is `ambiguous`, which parks rather than guesses. A `responseType` we do not recognise degrades to
 * a text question rather than producing an unanswerable card.
 *
 * @param input - The raw tool input from the model.
 * @returns The request to raise, always valid against `ElicitationRequestSchema`.
 */
export function elicitationRequestFromToolInput(input: unknown): ElicitationRequest {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const question =
    typeof raw['question'] === 'string' && raw['question'].trim().length > 0
      ? raw['question'].trim()
      : 'I need your input to continue.';
  const actionSummary =
    typeof raw['actionSummary'] === 'string' && raw['actionSummary'].trim().length > 0
      ? raw['actionSummary'].trim()
      : question;
  const parsed = ElicitationRequestSchema.safeParse({
    question,
    actionSummary,
    spec: specFromToolInput(raw),
    timeoutPolicy: raw['timeoutPolicy'],
    autoResolveValue: raw['autoResolveValue'] ?? null,
    autoResolveReason:
      typeof raw['autoResolveReason'] === 'string' ? raw['autoResolveReason'] : null,
    timeSensitive: raw['timeSensitive'] === true,
  });
  /* v8 ignore next -- @preserve defensive: every branch above produces a parseable request */
  if (!parsed.success) throw new Error('ask_user input could not be normalized');
  return parsed.data;
}

/** Map the model's flat `responseType` + hints onto a control spec. */
function specFromToolInput(raw: Record<string, unknown>): ElicitationSpec {
  const responseType = typeof raw['responseType'] === 'string' ? raw['responseType'] : 'text';
  if (responseType === 'confirm') {
    return {
      kind: 'confirm',
      confirmLabel: stringOr(raw['confirmLabel'], 'Yes, do it'),
      declineLabel: stringOr(raw['declineLabel'], 'No, stop'),
    };
  }
  if (responseType === 'select') {
    const options = toolOptions(raw['options']);
    if (options.length > 0) {
      return { kind: 'select', options, multiple: raw['multiple'] === true };
    }
  }
  if (responseType === 'datetime') {
    return {
      kind: 'datetime',
      precision:
        raw['precision'] === 'date' || raw['precision'] === 'time' ? raw['precision'] : 'datetime',
      timeZone: stringOr(raw['timeZone'], 'UTC'),
      min: typeof raw['min'] === 'string' ? raw['min'] : null,
      max: typeof raw['max'] === 'string' ? raw['max'] : null,
    };
  }
  if (responseType === 'file') {
    const accept = Array.isArray(raw['accept'])
      ? raw['accept'].filter((entry): entry is string => typeof entry === 'string')
      : [];
    return { kind: 'file', accept, maxBytes: 25 * 1024 * 1024, multiple: raw['multiple'] === true };
  }
  if (responseType === 'form') {
    const fields = toolFields(raw['fields']);
    if (fields.length > 0) return { kind: 'form', fields };
  }
  return {
    kind: 'text',
    multiline: raw['multiline'] === true,
    minLength: null,
    maxLength: null,
    placeholder: typeof raw['placeholder'] === 'string' ? raw['placeholder'] : null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Read the model's option list, dropping anything without a usable value. */
function toolOptions(
  value: unknown,
): { value: string; label: string; description: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [{ value: entry, label: entry, description: null }];
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const optionValue = typeof record['value'] === 'string' ? record['value'] : null;
    if (!optionValue) return [];
    return [
      {
        value: optionValue,
        label: stringOr(record['label'], optionValue),
        description: typeof record['description'] === 'string' ? record['description'] : null,
      },
    ];
  });
}

/** Read the model's form field list; each field becomes one labeled control. */
function toolFields(value: unknown): ElicitationField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const key = typeof record['key'] === 'string' ? record['key'] : null;
    if (!key) return [];
    return [
      {
        key,
        label: stringOr(record['label'], key),
        description: typeof record['description'] === 'string' ? record['description'] : null,
        required: record['required'] !== false,
        control: specFromToolInput({ ...record, responseType: record['type'] ?? 'text' }),
      },
    ];
  });
}

/**
 * Give every transcript question that has no typed request behind it one.
 *
 * @remarks
 * The agent loop writes its `elicitation` transcript rows inside the same transaction as the rest
 * of an assistant turn, behind a run-generation fence that this service must not reach into. So the
 * loop writes the row and calls this immediately afterwards; the pairing is idempotent (the unique
 * index on `activity_id` is the backstop) and recovers on the next turn if the process dies in
 * between, which is why the loop can stay ignorant of tasks, deadlines and notifications.
 *
 * @param sessionId - The session whose transcript to reconcile.
 * @param now - The clock; injected so tests can fast-forward.
 * @param notify - Push-sender injection for tests.
 * @returns The questions that were materialized by this call.
 */
export async function materializeElicitations(
  sessionId: string,
  now: Date = new Date(),
  notify: NotifyElicitationDeps = {},
): Promise<readonly RaiseElicitationResult[]> {
  const sessions = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  const session = sessions[0];
  if (!session?.ownerUserId) return [];
  const askedUserId = session.ownerUserId;

  const pending = await db
    .select({ id: sessionActivity.id, body: sessionActivity.body })
    .from(sessionActivity)
    .leftJoin(agentElicitation, eq(agentElicitation.activityId, sessionActivity.id))
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'elicitation'),
        sql`${agentElicitation.id} is null`,
      ),
    )
    .orderBy(asc(sessionActivity.createdAt));
  if (pending.length === 0) return [];

  const results: RaiseElicitationResult[] = [];
  for (const activity of pending) {
    const request = elicitationRequestFromToolInput({
      ...activity.body,
      question: activity.body.text,
    });
    const { taskId, organizationId } = await ensureElicitationTask(
      session,
      request.actionSummary,
      request.question,
    );
    const { live } = await readAthenaPresence(askedUserId, now);
    const derivable =
      request.timeoutPolicy === 'derivable' &&
      parseElicitationAnswer(request.spec, request.autoResolveValue).ok;
    const toolUseId =
      typeof activity.body['toolUseId'] === 'string' ? activity.body['toolUseId'] : null;
    const row = await db.transaction((tx) =>
      insertElicitationRow(tx, {
        session,
        activityId: activity.id,
        askedUserId,
        organizationId,
        taskId,
        request,
        timeoutPolicy: derivable
          ? 'derivable'
          : request.timeoutPolicy === 'derivable'
            ? 'ambiguous'
            : request.timeoutPolicy,
        derivable,
        live,
        expiresAt: new Date(now.getTime() + ELICITATION_DEFAULT_TTL_MS),
        toolUseId,
      }),
    );
    const titles = await db
      .select({ title: task.title })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    {
      await emitElicitationEvent({
        organizationId,
        kind: 'elicitation_requested',
        sessionId,
        elicitationId: row.id,
        askedUserId,
        occurredAt: now,
        question: request.question,
        expiresAt: row.expiresAt.toISOString(),
        permalink: elicitationPermalink(row.id),
      });
    }
    results.push({
      elicitation: row,
      activityId: activity.id,
      taskId,
      live,
      // Same fallback, same justification as `raiseElicitation`'s: `taskId` was just proven to
      // exist by `ensureElicitationTask` a moment ago, so `titles` comes up empty only if the
      // task was deleted in that same narrow, not fault-injectably-testable window.
      /* v8 ignore next -- @preserve defensive: see remark above */
      notified: await notifyElicitation(row, titles[0]?.title ?? request.actionSummary, notify),
    });
  }
  return results;
}

/* -------------------------------------------------------------------------------------------- */
/* Answering                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/** The outcome of submitting one answer. */
export type AnswerElicitationResult =
  | { readonly ok: true; readonly elicitation: ElicitationRow; readonly value: unknown }
  | { readonly ok: false; readonly errors: readonly ElicitationFieldError[] };

/** Who is submitting an answer, and therefore who gets the credit. */
export type ElicitationAnswerSource = 'user' | 'athena';

/** Everything needed to submit one answer. */
export interface AnswerElicitationInput {
  /** The question being answered. */
  readonly elicitationId: string;
  /** The person answering; must be the person asked. Omitted when Athena answers herself. */
  readonly userId?: string;
  /** The submitted value, straight off the wire. */
  readonly value: unknown;
  /** Who is answering. */
  readonly source?: ElicitationAnswerSource;
  /** Athena's reasoning, when she is the one answering. */
  readonly reason?: string | null;
  /** The clock; injected so tests can fast-forward. */
  readonly now?: Date;
}

/**
 * Render one accepted answer as the sentence that goes into the transcript.
 *
 * @remarks
 * The transcript is prose and the answer is typed data, so something has to bridge them. This is
 * Docket's own rendering — it never stringifies a raw payload into the conversation, and the
 * authoritative typed value stays on the elicitation row where the agent reads it.
 *
 * @param spec - The declared shape, used to name choices by their labels.
 * @param value - The parsed answer.
 * @returns One line describing what was answered.
 */
export function describeElicitationAnswer(spec: ElicitationSpec, value: unknown): string {
  if (spec.kind === 'confirm') return value === true ? spec.confirmLabel : spec.declineLabel;
  if (spec.kind === 'select') {
    const chosen = Array.isArray(value) ? value : [value];
    const labels = chosen.map((entry) => {
      const option = spec.options.find((candidate) => candidate.value === entry);
      return option ? option.label : String(entry);
    });
    return labels.join(', ');
  }
  if (spec.kind === 'text' || spec.kind === 'datetime') return String(value);
  if (spec.kind === 'number') return String(value);
  if (spec.kind === 'file') {
    const files = Array.isArray(value) ? value : [value];
    return files
      .map((file) =>
        file && typeof file === 'object' && 'fileName' in file
          ? String((file as { fileName: unknown }).fileName)
          : 'a file',
      )
      .join(', ');
  }
  if (spec.kind === 'form') {
    const record = (value ?? {}) as Record<string, unknown>;
    return spec.fields
      .map(
        (field) => `${field.label}: ${describeElicitationAnswer(field.control, record[field.key])}`,
      )
      .join(' · ');
  }
  if (spec.kind === 'list') {
    const items = Array.isArray(value) ? value : [];
    if (items.length === 0) return 'nothing';
    return items.map((item) => describeElicitationAnswer(spec.item, item)).join(', ');
  }
  const record = (value ?? {}) as Record<string, unknown>;
  const tagValue = record[spec.discriminator];
  const tag = typeof tagValue === 'string' ? tagValue : '';
  const variant = spec.variants.find((candidate) => candidate.value === tag);
  if (!variant) return tag;
  const details = variant.fields
    .map(
      (field) => `${field.label}: ${describeElicitationAnswer(field.control, record[field.key])}`,
    )
    .join(' · ');
  return details ? `${variant.label} — ${details}` : variant.label;
}

/**
 * Validate and record one answer, unblocking the waiting agent.
 *
 * @remarks
 * The elicitation row is locked `FOR UPDATE` and re-checked inside the transaction, so two tabs (or
 * a tap on a notification racing a click in the app) cannot both answer the same question. A
 * refusal returns before anything is written: the question stays `pending` with its deadline
 * intact, which is what lets the client re-render the form without losing the person's input.
 *
 * @param input - See {@link AnswerElicitationInput}.
 * @returns The settled question and its parsed value, or the per-field reasons it was refused.
 * @throws {NotFoundError} When the question does not exist or is not addressed to this person.
 * @throws {ConflictError} When the question has already been settled.
 */
export async function answerElicitation(
  input: AnswerElicitationInput,
): Promise<AnswerElicitationResult> {
  const now = input.now ?? new Date();
  const source = input.source ?? 'user';
  const rows = await db
    .select()
    .from(agentElicitation)
    .where(eq(agentElicitation.id, input.elicitationId))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new NotFoundError('Question not found');
  if (input.userId && existing.askedUserId !== input.userId) {
    throw new NotFoundError('Question not found');
  }
  if (existing.status !== 'pending') throw new ConflictError('This question is already settled.');

  const parsed = parseElicitationAnswer(existing.spec, input.value);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const settled = await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(agentElicitation)
      .where(eq(agentElicitation.id, existing.id))
      .for('update')
      .limit(1);
    const current = locked[0];
    /* v8 ignore next -- @preserve defensive: the row was read a statement ago */
    if (!current) throw new NotFoundError('Question not found');
    if (current.status !== 'pending') throw new ConflictError('This question is already settled.');

    const [updated] = await tx
      .update(agentElicitation)
      .set({
        status: source === 'user' ? 'answered' : 'auto_resolved',
        resolver: source,
        answer: parsed.value,
        settledAt: now,
        ...(source === 'athena' && input.reason ? { autoResolveReason: input.reason } : {}),
      })
      .where(eq(agentElicitation.id, current.id))
      .returning();
    /* v8 ignore next -- @preserve defensive: update always returns the locked row */
    if (!updated) throw new Error('elicitation update returned no row');

    await insertAnswerActivity(tx, updated, parsed.value, source, input.reason ?? null);
    return updated;
  });

  if (settled.organizationId) {
    await emitElicitationEvent({
      organizationId: settled.organizationId,
      kind: source === 'user' ? 'elicitation_answered' : 'elicitation_expired',
      sessionId: settled.sessionId,
      elicitationId: settled.id,
      askedUserId: settled.askedUserId,
      occurredAt: now,
      question: settled.question,
      ...(source === 'user'
        ? { answer: describeElicitationAnswer(settled.spec, parsed.value) }
        : { autoResolvedValue: describeElicitationAnswer(settled.spec, parsed.value) }),
      permalink: elicitationPermalink(settled.id),
    });
  }

  return { ok: true, elicitation: settled, value: parsed.value };
}

/**
 * Append the transcript row that answers the waiting tool call.
 *
 * @remarks
 * The `toolUseId` is what makes the answer *typed delivery* rather than a comment: the agent loop
 * pairs this row back to the exact `tool_use` block it is waiting on, and the JSON body it reads is
 * the parsed value — the prose is only what a person sees.
 */
async function insertAnswerActivity(
  tx: Database,
  row: ElicitationRow,
  value: unknown,
  source: ElicitationAnswerSource,
  reason: string | null,
): Promise<void> {
  const prose = describeElicitationAnswer(row.spec, value);
  const text = source === 'athena' ? `${prose}${reason ? ` — ${reason}` : ''}` : prose;
  await tx.insert(sessionActivity).values({
    sessionId: row.sessionId,
    organizationId: null,
    type: 'response',
    body: {
      text,
      author: source === 'user' ? 'user' : 'athena',
      elicitationId: row.id,
      // The typed payload the agent consumes. Serialized alongside the prose rather than instead
      // of it, so the transcript stays readable and the tool result stays exact.
      elicitationAnswer: value,
      ...(row.toolUseId ? { toolUseId: row.toolUseId } : {}),
    },
  });
}

/**
 * Withdraw one question because the work it belonged to stopped.
 *
 * @param elicitationId - The question to withdraw.
 * @param now - The clock; injected so tests can fast-forward.
 * @returns The settled row, or `null` when it was already settled.
 */
export async function cancelElicitation(
  elicitationId: string,
  now: Date = new Date(),
): Promise<ElicitationRow | null> {
  const [row] = await db
    .update(agentElicitation)
    .set({ status: 'canceled', resolver: 'timeout', settledAt: now })
    .where(and(eq(agentElicitation.id, elicitationId), eq(agentElicitation.status, 'pending')))
    .returning();
  return row ?? null;
}

/* -------------------------------------------------------------------------------------------- */
/* Expiry                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** What one deadline sweep settled. */
export interface ElicitationSweepResult {
  /** Questions Athena answered herself because a defensible default was declared. */
  readonly autoResolved: number;
  /** Questions parked because no answer was derivable; nothing was mutated for these. */
  readonly parked: number;
}

/** The sentence a parked question leaves in the transcript. Application-owned copy. */
export function parkedElicitationNote(policy: 'ambiguous' | 'destructive'): string {
  return policy === 'destructive'
    ? 'This needs your decision — it cannot be undone, so I am not choosing for you. The work is on hold until you answer.'
    : 'Either answer is defensible here, so I am not choosing for you. The work is on hold until you answer.';
}

/**
 * Settle every question whose deadline has passed.
 *
 * @remarks
 * The two branches are the whole point:
 *
 * - `derivable` — the raiser declared a defensible default *and its reasoning*, so Athena records
 *   it as her own decision (`resolver: 'athena'`, status `auto_resolved`), states the reasoning in
 *   the transcript, and the blocked session resumes.
 * - `ambiguous` / `destructive` — nobody may choose. The question is `parked`, the transcript says
 *   the work is waiting on the person, and **no mutation is attempted**: no answer is written, no
 *   tool result is delivered, so a session parked this way stays exactly where it was.
 *
 * @param now - The clock; injected so tests can fast-forward past a deadline.
 * @returns How many went each way.
 */
export async function sweepElicitations(now: Date = new Date()): Promise<ElicitationSweepResult> {
  const due = await db
    .select()
    .from(agentElicitation)
    .where(and(eq(agentElicitation.status, 'pending'), lte(agentElicitation.expiresAt, now)))
    .orderBy(asc(agentElicitation.expiresAt))
    .limit(200);

  let autoResolved = 0;
  let parked = 0;
  for (const row of due) {
    if (row.timeoutPolicy === 'derivable') {
      const result = await answerElicitation({
        elicitationId: row.id,
        value: row.autoResolveValue,
        source: 'athena',
        reason: row.autoResolveReason,
        now,
      }).catch(() => null);
      if (result?.ok) {
        autoResolved += 1;
        continue;
      }
    }
    await parkElicitation(row, now);
    parked += 1;
  }
  return { autoResolved, parked };
}

/** Park one question: say so in the transcript, mutate nothing else. */
async function parkElicitation(row: ElicitationRow, now: Date): Promise<void> {
  const policy = row.timeoutPolicy === 'destructive' ? 'destructive' : 'ambiguous';
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(agentElicitation)
      .set({ status: 'parked', resolver: 'timeout', settledAt: now })
      .where(and(eq(agentElicitation.id, row.id), eq(agentElicitation.status, 'pending')))
      .returning({ id: agentElicitation.id });
    if (!updated) return;
    await tx.insert(sessionActivity).values({
      sessionId: row.sessionId,
      organizationId: null,
      type: 'response',
      body: {
        text: parkedElicitationNote(policy),
        author: 'athena',
        elicitationId: row.id,
        elicitationParked: true,
      },
    });
  });

  if (row.organizationId) {
    await emitElicitationEvent({
      organizationId: row.organizationId,
      kind: 'elicitation_expired',
      sessionId: row.sessionId,
      elicitationId: row.id,
      askedUserId: row.askedUserId,
      occurredAt: now,
      question: row.question,
      autoResolvedValue: null,
      permalink: elicitationPermalink(row.id),
    });
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Reading                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/** One elicitation joined to the title of the task it implements. */
export interface ElicitationWithTask {
  /** The question row. */
  readonly row: ElicitationRow;
  /** The linked task's title. */
  readonly taskTitle: string;
}

/** Load one question addressed to a person, with its task. */
export async function loadElicitation(
  elicitationId: string,
  userId: string,
): Promise<ElicitationWithTask> {
  const rows = await db
    .select({ row: agentElicitation, taskTitle: task.title })
    .from(agentElicitation)
    .innerJoin(task, eq(task.id, agentElicitation.taskId))
    .where(and(eq(agentElicitation.id, elicitationId), eq(agentElicitation.askedUserId, userId)))
    .limit(1);
  const found = rows[0];
  if (!found) throw new NotFoundError('Question not found');
  return found;
}

/**
 * Every question currently addressed to a person.
 *
 * @remarks
 * Pending questions first and oldest-first within that, because the one that has been blocking
 * longest is the one that costs the most to keep ignoring. Recently settled questions follow so a
 * surface can show the answer that was just given without a second round trip.
 *
 * @param userId - The person being asked.
 * @param limit - How many rows to return.
 */
export async function listElicitationsFor(
  userId: string,
  limit = 50,
): Promise<readonly ElicitationWithTask[]> {
  return db
    .select({ row: agentElicitation, taskTitle: task.title })
    .from(agentElicitation)
    .innerJoin(task, eq(task.id, agentElicitation.taskId))
    .where(eq(agentElicitation.askedUserId, userId))
    .orderBy(
      sql`case when ${agentElicitation.status} = 'pending' then 0 else 1 end`,
      asc(agentElicitation.expiresAt),
    )
    .limit(limit);
}

/** Load the questions attached to a set of sessions, for transcript rendering. */
export async function elicitationsForSessions(
  sessionIds: readonly string[],
): Promise<readonly ElicitationWithTask[]> {
  if (sessionIds.length === 0) return [];
  return db
    .select({ row: agentElicitation, taskTitle: task.title })
    .from(agentElicitation)
    .innerJoin(task, eq(task.id, agentElicitation.taskId))
    .where(inArray(agentElicitation.sessionId, [...sessionIds]))
    .orderBy(asc(agentElicitation.createdAt));
}

/** Serialize one question for the wire. */
export function toElicitationOut(entry: ElicitationWithTask): ElicitationOut {
  const { row, taskTitle } = entry;
  return {
    id: row.id,
    sessionId: row.sessionId,
    task: {
      id: row.taskId,
      title: taskTitle,
      href: elicitationTaskHref(row.organizationId, row.taskId),
    },
    question: row.question,
    actionSummary: row.actionSummary,
    spec: row.spec,
    status: row.status,
    timeoutPolicy: row.timeoutPolicy,
    timeSensitive: row.timeSensitive,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    resolver: row.resolver,
    answer: row.answer ?? null,
    autoResolveReason: row.autoResolveReason,
    live: row.live,
  };
}
