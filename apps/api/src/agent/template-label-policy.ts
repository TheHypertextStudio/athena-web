/** Stored source choices constrain every proposal producer, independently of model instructions. */
import { agentSession, sessionActivity, type Database } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { LabelTemplateSuggestionRequest } from '@docket/work/template-gallery-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { CapabilityError, NotFoundError } from '../error';
import { isTemplateTailoring } from './template-tailoring-policy';

/** Refuse a different work kind before any proposal, notification or same-transaction draft survives. */
export async function requireLabelSuggestionKind(
  database: Database,
  sessionId: string,
  kind: TemplateTargetType,
): Promise<void> {
  const [session] = await database
    .select({ externalRunRef: agentSession.externalRunRef })
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  if (!session) throw new NotFoundError();
  if (!isTemplateTailoring(session)) return;
  const [activity] = await database
    .select({ body: sessionActivity.body })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'response'),
        sql`${sessionActivity.body} ? 'templateLabelSuggestion'`,
      ),
    )
    .limit(1)
    .for('share');
  if (!activity) return;
  const selected = LabelTemplateSuggestionRequest.safeParse(
    activity.body['templateLabelSuggestion'],
  );
  if (!selected.success || 'templateTailoring' in activity.body || selected.data.kind !== kind)
    throw new CapabilityError();
}
