/** The persisted session, never model prose, restricts a tailored suggestion to review only. */
import { agentSession, db } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { ToolboxExecutor } from './toolbox';
import { CapabilityError } from '../error';

/** Stable server-owned namespace for durable context fingerprints. */
export const TEMPLATE_TAILORING_PREFIX = 'template-tailor:';
/** Identify an actual stored restricted generation row. */
export function isTemplateTailoring(
  session: Pick<typeof agentSession.$inferSelect, 'externalRunRef'>,
): boolean {
  return session.externalRunRef?.startsWith(TEMPLATE_TAILORING_PREFIX) === true;
}
/** Resolve restriction only after matching the toolbox's true persisted owner. */
export async function tailoringToolboxRestricted(
  executor: ToolboxExecutor,
  sessionId: string | null,
): Promise<boolean> {
  if (!sessionId) return false;
  const [session] = await db.select().from(agentSession).where(eq(agentSession.id, sessionId));
  if (!session || !isTemplateTailoring(session)) return false;
  if (
    executor.kind !== 'athena' ||
    session.executorKind !== 'athena' ||
    session.ownerUserId !== executor.ownerUserId
  )
    throw new CapabilityError();
  return true;
}
/** Reject hallucinated or cross-workspace tools before recording any action. */
export function requireTailoringTool(
  session: typeof agentSession.$inferSelect,
  name: string,
  input: unknown,
): void {
  if (!isTemplateTailoring(session)) return;
  if (
    name !== 'define_template' ||
    !input ||
    typeof input !== 'object' ||
    !('orgId' in input) ||
    input.orgId !== session.contextOrganizationId
  )
    throw new CapabilityError();
}

/** Tailoring always waits for human review, independently of the personal autonomy preference. */
export function mayExecuteTemplateAutomatically(
  session: typeof agentSession.$inferSelect,
  decision: string,
): boolean {
  return !isTemplateTailoring(session) && decision === 'execute';
}
