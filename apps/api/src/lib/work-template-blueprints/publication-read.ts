import { blueprintStep, template, workTypeVersion } from '@docket/db';
import { OrganizationId } from '@docket/identity-access/ids';
import { BlueprintStepId, WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type { PublishedBlueprintSnapshot } from '@docket/work/blueprints';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq, isNull } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintSelection } from './resolve';

/** Read an exact tenant/kind-correlated immutable publication under the caller's archive policy. */
export async function readBlueprintPublication(
  tx: TemplateTransaction,
  selection: BlueprintSelection,
  policy: { readonly archived: boolean; readonly draft: boolean },
): Promise<PublishedBlueprintSnapshot> {
  const [row] = await tx
    .select({ definition: template, version: workTypeVersion })
    .from(template)
    .innerJoin(
      workTypeVersion,
      and(
        eq(workTypeVersion.workTypeId, template.id),
        eq(workTypeVersion.organizationId, template.organizationId),
        eq(workTypeVersion.id, selection.workTypeVersionId ?? template.latestPublishedVersionId),
      ),
    )
    .where(
      and(
        eq(template.organizationId, selection.organizationId),
        eq(template.targetType, selection.kind),
        selection.workTypeId ? eq(template.id, selection.workTypeId) : eq(template.isBase, true),
        eq(template.scope, 'organization'),
        policy.draft || policy.archived ? undefined : eq(template.publicationState, 'published'),
        policy.archived ? undefined : isNull(template.archivedAt),
      ),
    )
    .limit(1);
  if (!row || (!policy.draft && row.definition.publicationState === 'draft'))
    throw new NotFoundError('Template not found');
  const definition = WorkTemplateDefinition.parse(row.version.definition);
  if (definition.payload.targetType !== selection.kind)
    throw new NotFoundError('Template not found');
  const projections = await tx
    .select({ key: blueprintStep.key, id: blueprintStep.id })
    .from(blueprintStep)
    .where(
      and(
        eq(blueprintStep.organizationId, selection.organizationId),
        eq(blueprintStep.versionId, row.version.id),
      ),
    );
  return {
    organizationId: OrganizationId.parse(selection.organizationId),
    kind: selection.kind,
    workTypeId: WorkTypeId.parse(row.definition.id),
    versionId: WorkTypeVersionId.parse(row.version.id),
    definition,
    stepIds: Object.fromEntries(
      projections.map((step) => [step.key, BlueprintStepId.parse(step.id)]),
    ),
  };
}
