import type { template, workTypeVersion } from '@docket/db';
import type { TemplateOut } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { z } from 'zod';

/** The single persisted definition shared by canonical and legacy APIs. */
export type TemplateRow = typeof template.$inferSelect;
/** An immutable publication row. */
export type TemplateVersionRow = typeof workTypeVersion.$inferSelect;
/** The observable states around a compatible template edit. */
export interface TemplateUpdateResult {
  readonly before: TemplateRow;
  readonly after: TemplateRow;
}

/** Read canonical draft data, tolerating the legacy insert projection before its trigger runs. */
export function draftOf(row: TemplateRow): WorkTemplateDefinition {
  return WorkTemplateDefinition.parse(row.draftDefinition);
}

/** Serialize only the published legacy projection, never an unpublished revision. */
export function toTemplateOut(row: TemplateRow): z.input<typeof TemplateOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetType: row.targetType,
    name: row.name,
    description: row.description,
    scope: row.scope,
    ownerActorId: row.ownerActorId,
    teamId: row.teamId,
    payload: row.payload,
    isSeed: row.isSeed,
    workTypeVersionId: row.latestPublishedVersionId,
    publicationState: row.publicationState === 'legacy_pending' ? 'draft' : row.publicationState,
    isBase: row.isBase,
    createdAt: row.createdAt.toISOString(),
  };
}
