/**
 * `@docket/api` — the process-wide agent bus and the one way an agent reports.
 *
 * @remarks
 * Athena spawns agents for specific tasks; each of them runs independently and none of them can
 * see the others. The only thing that makes "what is happening right now" answerable is that all
 * of them report through the same bus, and that the bus keeps what they said.
 *
 * A report lands in three places, deliberately, because each answers a different question:
 *
 * | where | answers | survives |
 * | --- | --- | --- |
 * | {@link agentBus} (in-process, replayed) | "what changed in the last second" | process lifetime |
 * | `agent_session.current_step` | "what is this agent doing right now" | reload, restart |
 * | the `event` log via `emitAgentMilestone` | "what did it do, in order" | forever |
 *
 * Dropping any one of them breaks a requirement: no bus and a UI cannot live-update; no session
 * column and a reload shows a spinner instead of a step; no event row and the milestones vanish
 * when the process restarts. They are written in that order — cheapest and most local first — so
 * a failure of the durable write can never cost the live one.
 */
import { agentSession, db } from '@docket/db';
import {
  InMemoryAgentBus,
  type AgentBusFilter,
  type AgentUpdate,
  type AgentUpdateKind,
} from '@docket/athena/agent-bus';
import { eq } from 'drizzle-orm';

import { emitAgentMilestone } from './event-emit';

export type { AgentBusFilter, AgentUpdate, AgentUpdateKind };

/**
 * The one bus for this process.
 *
 * @remarks
 * A module singleton for the same reason `lib/event-bus.ts` is one: a second bus would be a
 * second place agents report to, and a subscriber attached to the wrong one would silently see
 * nothing. Multi-instance fan-out is the durable event log's job, not this one's.
 */
export const agentBus = new InMemoryAgentBus();

/** What an agent is reporting. */
export interface AgentReport {
  /** The reporting agent's session. */
  readonly sessionId: string;
  /** The human the work belongs to. */
  readonly ownerUserId: string;
  /** The lifecycle verb. */
  readonly kind: AgentUpdateKind;
  /** The current step, in the agent's own words. Rendered as content, never as error copy. */
  readonly milestone: string;
  /** Self-reported completion, 0–100. */
  readonly progress?: number | null;
  /** A stable machine code for a block or failure. Never rendered verbatim. */
  readonly reasonCode?: string | null;
  /**
   * Skip the durable `agent_session.current_step` write.
   *
   * @remarks
   * Set when the caller has already updated the row inside its own transaction, so the step is
   * not written twice — the bus and the event log still receive the report.
   */
  readonly stepAlreadyPersisted?: boolean;
  /**
   * Report even though the session has been interrupted.
   *
   * @remarks
   * Reserved for the dispatcher announcing that the interrupt landed. The guard exists to stop
   * the *agent* writing after a stop; the sentence "it stopped" is the dispatcher's, and it is
   * the last thing said about that session.
   */
  readonly allowAfterInterrupt?: boolean;
}

/** The persisted identity a report needs; loaded once per report. */
interface ReportingSession {
  readonly parentSessionId: string | null;
  readonly taskId: string | null;
  readonly spawnLabel: string | null;
  readonly contextOrganizationId: string | null;
  readonly initiatorId: string | null;
  readonly interruptedAt: Date | null;
}

/** Load the columns a report needs, or `null` when the session is gone. */
async function reportingSession(sessionId: string): Promise<ReportingSession | null> {
  const rows = await db
    .select({
      parentSessionId: agentSession.parentSessionId,
      taskId: agentSession.taskId,
      spawnLabel: agentSession.spawnLabel,
      contextOrganizationId: agentSession.contextOrganizationId,
      initiatorId: agentSession.initiatorId,
      interruptedAt: agentSession.interruptedAt,
    })
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The name a spawned agent reports under.
 *
 * @remarks
 * Always Athena, qualified by the specific task she spawned this agent for. There is no second
 * assistant identity and there is no "sub" anything: one agent, many concurrent pieces of work.
 */
export function agentDisplayName(spawnLabel: string | null): string {
  return spawnLabel && spawnLabel.trim().length > 0 ? `Athena · ${spawnLabel.trim()}` : 'Athena';
}

/**
 * Report one milestone from a running agent.
 *
 * @remarks
 * Reports from a session that has already been interrupted are dropped, not recorded. An
 * interrupt is supposed to mean the work stopped; a milestone arriving afterwards would be a
 * record of it not having stopped, and the whole point of stamping `interrupted_at` is that
 * "nothing kept running and writing" is checkable.
 *
 * @param report - What the agent is reporting.
 * @returns the published update, or `null` when the session is gone or already interrupted.
 */
export async function reportAgentMilestone(report: AgentReport): Promise<AgentUpdate | null> {
  const session = await reportingSession(report.sessionId);
  if (!session) return null;
  if (session.interruptedAt !== null && report.allowAfterInterrupt !== true) return null;

  const agentName = agentDisplayName(session.spawnLabel);
  const update = agentBus.publish({
    sessionId: report.sessionId,
    parentSessionId: session.parentSessionId,
    ownerUserId: report.ownerUserId,
    agentName,
    taskId: session.taskId,
    kind: report.kind,
    milestone: report.milestone,
    ...(report.progress === undefined ? {} : { progress: report.progress }),
    ...(report.reasonCode === undefined ? {} : { reasonCode: report.reasonCode }),
  });

  if (!report.stepAlreadyPersisted) {
    await db
      .update(agentSession)
      .set({ currentStep: report.milestone, currentStepAt: update.at })
      .where(eq(agentSession.id, report.sessionId));
  }

  // The durable arm needs a workspace: the event log is tenant-scoped. Personal Athena work with
  // no workspace focus still reports live and still persists its step on the session row; it just
  // has no tenant feed to land in, which is correct — there is no workspace for it to be news to.
  if (session.contextOrganizationId) {
    await emitAgentMilestone({
      organizationId: session.contextOrganizationId,
      kind: report.kind,
      sessionId: report.sessionId,
      parentSessionId: session.parentSessionId,
      ownerUserId: report.ownerUserId,
      agentActorId: session.initiatorId,
      occurredAt: update.at,
      agentName,
      milestone: report.milestone,
      progress: update.progress,
      reasonCode: update.reasonCode,
      ...(session.taskId ? { subject: { type: 'task', id: session.taskId } } : {}),
    });
  }
  return update;
}

/**
 * Subscribe to the merged stream of every agent's updates.
 *
 * @param filter - Which slice to receive; replay is included before the live tail.
 * @param listener - Invoked per matching update in sequence order.
 * @returns a detach function.
 */
export function subscribeAgentUpdates(
  filter: AgentBusFilter,
  listener: (update: AgentUpdate) => void,
): () => void {
  return agentBus.subscribe(filter, listener);
}

/**
 * Read the retained merged stream without attaching.
 *
 * @param filter - Which slice to read.
 */
export function readAgentUpdates(filter?: AgentBusFilter): readonly AgentUpdate[] {
  return agentBus.history(filter);
}
