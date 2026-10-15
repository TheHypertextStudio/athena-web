import { workTypeVersion } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from './persistence';
import { TemplateOut } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { TemplateRow } from './model';

const snapshot = TemplateOut.pick({
  name: true,
  description: true,
  scope: true,
  ownerActorId: true,
  teamId: true,
  payload: true,
});

/** Trusted undo snapshot normalized before any publication locks or writes. */
export interface TemplateRestoration {
  readonly prior: Pick<
    TemplateOut,
    'name' | 'description' | 'scope' | 'ownerActorId' | 'teamId' | 'payload'
  >;
  readonly priorDraft: WorkTemplateDefinition;
  readonly definition: WorkTemplateDefinition;
  readonly changedPublication: boolean;
  readonly retainedVersionId: string | null;
}

/** Derive a prior draft/publication from a stored receipt without changing immutable history. */
export function prepareTemplateRestoration(
  current: TemplateRow,
  before: Record<string, unknown>,
  priorPublication?: WorkTemplateDefinition,
): TemplateRestoration | null {
  const prior = snapshot.parse(before);
  if (current.latestPublishedVersionId && prior.scope !== 'organization') return null;
  const priorDraft = WorkTemplateDefinition.parse(
    before['draftDefinition'] ?? {
      ...current.draftDefinition,
      name: prior.name,
      description: prior.description,
      payload: prior.payload,
    },
  );
  const changedPublication =
    current.latestPublishedVersionId !== null &&
    before['latestPublishedVersionId'] !== current.latestPublishedVersionId;
  return {
    prior,
    priorDraft,
    changedPublication,
    retainedVersionId:
      typeof before['latestPublishedVersionId'] === 'string'
        ? before['latestPublishedVersionId']
        : current.latestPublishedVersionId,
    definition: changedPublication
      ? (priorPublication ??
        WorkTemplateDefinition.parse({
          ...priorDraft,
          name: prior.name,
          description: prior.description,
          icon: before['icon'] ?? null,
          payload: prior.payload,
        }))
      : priorDraft,
  };
}

/** Resolve the exact prior immutable public definition independently of the retained editable draft. */
export async function loadTemplateRestoration(
  tx: TemplateTransaction,
  current: TemplateRow,
  before: Record<string, unknown>,
): Promise<TemplateRestoration | null> {
  const prepared = prepareTemplateRestoration(current, before);
  if (!prepared?.changedPublication || typeof before['latestPublishedVersionId'] !== 'string')
    return prepared;
  const [previous] = await tx
    .select({ definition: workTypeVersion.definition })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, current.organizationId),
        eq(workTypeVersion.workTypeId, current.id),
        eq(workTypeVersion.id, before['latestPublishedVersionId']),
      ),
    )
    .limit(1);
  if (!previous) throw new NotFoundError('Template version not found');
  return prepareTemplateRestoration(
    current,
    before,
    WorkTemplateDefinition.parse(previous.definition),
  );
}
