/** One atomic recorder for checked saved-context and label-example suggestion requests. */
import { agentSession, sessionActivity } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { TemplateTransaction } from '../lib/templates/persistence';
import type { TailoringCaller } from './template-tailoring-context';
import { TEMPLATE_TAILORING_PREFIX } from './template-tailoring-policy';
import { saveTranscript } from './transcript';
import { markProvenance } from './provenance';

/** Internal checked facts; request handlers never accept these texts or context from JSON. */
interface CheckedSuggestion {
  readonly fingerprint: string;
  readonly metadata: Record<string, unknown>;
  readonly summary: string;
  readonly instruction: string;
  readonly context: unknown;
}
/** Save a private review-first session under the caller-owned source fingerprint lock. */
export async function recordTemplateSuggestion(
  tx: TemplateTransaction,
  caller: TailoringCaller,
  checked: CheckedSuggestion,
): Promise<typeof agentSession.$inferSelect> {
  const externalRunRef = TEMPLATE_TAILORING_PREFIX + checked.fingerprint;
  const [existing] = await tx
    .select()
    .from(agentSession)
    .where(eq(agentSession.externalRunRef, externalRunRef));
  if (existing) return existing;
  const [session] = await tx
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: caller.userId,
      contextOrganizationId: caller.orgId,
      kind: 'job',
      trigger: 'delegation',
      status: 'pending',
      initiatorId: caller.actorId,
      externalRunRef,
    })
    .returning();
  if (!session) throw new Error('Suggestion session not saved');
  await tx.insert(sessionActivity).values({
    sessionId: session.id,
    type: 'response',
    body: { text: checked.summary, ...checked.metadata },
  });
  await saveTranscript(
    tx,
    session.id,
    null,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: checked.instruction },
          {
            type: 'text',
            text: markProvenance(
              JSON.stringify(checked.context),
              'external_agent',
              'Selected saved Docket context',
            ),
          },
        ],
      },
    ],
    caller.userId,
  );
  return session;
}
