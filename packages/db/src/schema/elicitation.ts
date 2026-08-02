/**
 * `@docket/db` — the elicitation island: Athena's typed requests for data, and who is watching.
 *
 * @remarks
 * A `session_activity` row of type `elicitation` is the transcript entry — the thing a person
 * scrolls past. This island carries the parts that must be queryable and enforceable rather than
 * merely displayed:
 *
 * - **A deadline.** `expires_at` is `NOT NULL`, so "no elicitation may stay pending indefinitely"
 *   is a column rather than a habit. The sweep has something to scan; the card has something to
 *   show.
 * - **A task.** `task_id` is `NOT NULL`, so "elicitations answer questions that are used to
 *   implement tasks" is enforced by the database. There is no way to raise a question that floats
 *   free of the work it exists to unblock.
 * - **A timeout policy.** Only `derivable` may be answered by Athena in the person's place, and a
 *   CHECK requires such a row to actually carry the derived answer. A question whose default was
 *   never supplied cannot claim to have one.
 * - **A resolution attribution.** `resolver` records whether the person, Athena, or a clock ended
 *   the wait. `answered`/`auto_resolved` must name one; `pending` must not.
 *
 * {@link athenaPresence} lives here rather than in the auth island because its only consumer is
 * the liveness branch above: an elicitation raised while its recipient is watching is live and
 * answered in place, and one raised while they are away is a push notification. Presence with no
 * elicitation to qualify would be telemetry, which this product does not collect.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type {
  ElicitationResolver,
  ElicitationSpec,
  ElicitationStatus,
  ElicitationTimeoutPolicy,
} from '@docket/types';

import { genId } from '../id';
import { agentSession, sessionActivity } from './agents';
import { user } from './auth';
import { organization } from './identity';
import { task } from './work';

/**
 * One typed request for data, raised by an agent and addressed to exactly one person.
 *
 * @remarks
 * Stored beside its `session_activity` row rather than inside it: the activity row's `body` is a
 * free-form jsonb the whole transcript shares, and none of the guarantees above can be expressed
 * as a constraint on a jsonb blob.
 */
export const agentElicitation = pgTable(
  'agent_elicitation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** The session that is blocked on this answer. */
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    /** The transcript row a person reads; one elicitation per row. */
    activityId: text('activity_id')
      .notNull()
      .references(() => sessionActivity.id, { onDelete: 'cascade' }),
    /** Workspace attribution when the asking session has one; null for purely personal work. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    /** The one person who can answer. Notifications, presence and routing all key off this. */
    askedUserId: text('asked_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The work this question exists to implement. Not nullable — that is the point. */
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    /** The model's `tool_use` id, so the loop can hand the parsed answer back to the right call. */
    toolUseId: text('tool_use_id'),
    /** The question in the agent's own words. */
    question: text('question').notNull(),
    /** The concrete action this answer authorizes, in a sentence a person can audit. */
    actionSummary: text('action_summary').notNull(),
    /** The declared answer shape; the renderer and the validator read the same value. */
    spec: jsonb('spec').$type<ElicitationSpec>().notNull(),
    /** Lifecycle: `pending` → `answered` | `auto_resolved` | `parked` | `canceled`. */
    status: text('status').$type<ElicitationStatus>().notNull().default('pending'),
    /** What the deadline is allowed to do; only `derivable` may answer on the person's behalf. */
    timeoutPolicy: text('timeout_policy')
      .$type<ElicitationTimeoutPolicy>()
      .notNull()
      .default('ambiguous'),
    /** Whether waiting has a cost; drives push delivery and the live/absent branch. */
    timeSensitive: boolean('time_sensitive').notNull().default(false),
    /** Whether the asked person was watching Athena when this was raised. */
    live: boolean('live').notNull().default(false),
    /** The answer Athena records if nobody replies; required when the policy is `derivable`. */
    autoResolveValue: jsonb('auto_resolve_value'),
    /** Why that default is defensible; stated in the transcript when it is used. */
    autoResolveReason: text('auto_resolve_reason'),
    /** When this stops waiting. Not nullable — nothing pends forever. */
    expiresAt: timestamp('expires_at').notNull(),
    /** The recorded answer, already parsed to its declared type. */
    answer: jsonb('answer'),
    /** Who ended the wait: the person, Athena, or a clock that found no derivable answer. */
    resolver: text('resolver').$type<ElicitationResolver>(),
    /** When the wait ended. */
    settledAt: timestamp('settled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('agent_elicitation_activity_uq').on(t.activityId),
    index('agent_elicitation_session_idx').on(t.sessionId, t.createdAt),
    index('agent_elicitation_task_idx').on(t.taskId, t.createdAt),
    // The sweep's only query: everything still pending whose deadline has passed.
    index('agent_elicitation_pending_deadline_idx').on(t.status, t.expiresAt),
    index('agent_elicitation_asked_idx').on(t.askedUserId, t.status, t.expiresAt),
    check(
      'agent_elicitation_status_check',
      sql`${t.status} in ('pending', 'answered', 'auto_resolved', 'parked', 'canceled')`,
    ),
    check(
      'agent_elicitation_timeout_policy_check',
      sql`${t.timeoutPolicy} in ('derivable', 'ambiguous', 'destructive')`,
    ),
    check(
      'agent_elicitation_resolver_check',
      sql`${t.resolver} is null or ${t.resolver} in ('user', 'athena', 'timeout')`,
    ),
    // A settled row names who settled it; a pending row names nobody. Attribution cannot rot.
    check(
      'agent_elicitation_resolution_check',
      sql`(${t.status} = 'pending' AND ${t.resolver} IS NULL AND ${t.settledAt} IS NULL)
        OR (${t.status} <> 'pending' AND ${t.resolver} IS NOT NULL AND ${t.settledAt} IS NOT NULL)`,
    ),
    // Claiming a derivable default obliges you to have supplied one. Without this a question
    // could promise the timeout an answer it does not have, and the sweep would park work that
    // was supposed to keep moving — the failure mode is silent, so the database refuses it.
    check(
      'agent_elicitation_derivable_check',
      sql`${t.timeoutPolicy} <> 'derivable' OR ${t.autoResolveValue} IS NOT NULL`,
    ),
  ],
);

/**
 * When each person was last watching Athena, and where.
 *
 * @remarks
 * One row per person, overwritten by a heartbeat — this is a *current state*, not a log, so there
 * is nothing here to mine and nothing to retain. `focusedAt` is null once the surface reports it
 * lost focus, which is what distinguishes "away from the desk" from "never opened it".
 */
export const athenaPresence = pgTable(
  'athena_presence',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Last moment the Athena surface reported itself open and focused; null when blurred. */
    focusedAt: timestamp('focused_at'),
    /** Last heartbeat of any kind, focused or not. */
    seenAt: timestamp('seen_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('athena_presence_focused_idx').on(t.focusedAt)],
);
