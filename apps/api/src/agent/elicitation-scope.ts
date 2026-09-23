/**
 * `@docket/api` — materialize a session's questions under the session's own provenance.
 *
 * @remarks
 * The agent loop materializes the questions a turn raised after the turn's tool calls have run,
 * outside any tool call's provenance scope. A question can create the task it implements, and
 * that task is Athena's work, so the loop declares Athena's provenance here: `session` for a
 * delegated job, `chat` for a conversation. A registered agent's session keeps whatever scope the
 * caller already holds.
 */
import { athenaProvenance, runWithProvenance } from '../lib/provenance/context';
import type { SessionRow } from '../routes/agent-session-helpers';
import { materializeElicitations } from '../services/elicitation-service';

/**
 * Materialize every question the session raised this turn.
 *
 * @param session - The session whose transcript to reconcile.
 * @returns the questions that were materialized.
 */
export async function materializeSessionElicitations(
  session: SessionRow,
): ReturnType<typeof materializeElicitations> {
  if (session.executorKind !== 'athena') return materializeElicitations(session.id);
  const surface = session.kind === 'job' ? 'session' : 'chat';
  return runWithProvenance(athenaProvenance(surface, session.id), () =>
    materializeElicitations(session.id),
  );
}
