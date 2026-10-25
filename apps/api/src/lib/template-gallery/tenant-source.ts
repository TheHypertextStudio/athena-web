import { template, workTypeTeam, workTypeVersion } from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import {
  fingerprintCopyFacts,
  type CopyDefinitionSource,
  type CopyDraftReservation,
  type WorkTemplateCopySourceSelection,
} from '@docket/work/template-copy';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { NotFoundError } from '../../error';
import { mayAuthorTemplates } from '../templates/authorization';
import { templateCopyPendingSelection } from '../templates/copy-reference-integrity';
import { loadTemplateCopyActor } from '../templates/copy-reservation-context';
import type { TemplateTransaction } from '../templates/persistence';
import { visibleTemplateWhere } from '../templates/visibility';

type Selection = Exclude<WorkTemplateCopySourceSelection, { kind: 'catalog' }>;
/** Authorized source facts, with a private reservation only when a checked draft really owns that pin. */
export interface TenantCopySource {
  readonly source: CopyDefinitionSource;
  readonly reservation?: CopyDraftReservation;
}
async function sourceMetadata(tx: TemplateTransaction, caller: ActorCtx, id: string) {
  const [row] = await tx
    .select({
      id: template.id,
      targetType: template.targetType,
      publicationState: template.publicationState,
      latestPublishedVersionId: template.latestPublishedVersionId,
      draftRevision: template.draftRevision,
    })
    .from(template)
    .where(
      visibleTemplateWhere(caller.orgId, caller.actorId, {
        id,
        includeArchived: true,
        includeBase: true,
      }),
    )
    .for('share');
  if (!row) throw new NotFoundError('Template not found');
  return row;
}
type Metadata = Awaited<ReturnType<typeof sourceMetadata>>;
async function draftSource(
  tx: TemplateTransaction,
  caller: ActorCtx,
  row: Metadata,
  offeredTeamIds: readonly TeamId[],
): Promise<CopyDefinitionSource> {
  if (
    row.publicationState === 'archived' ||
    (row.latestPublishedVersionId && !(await mayAuthorTemplates(caller, tx)))
  )
    throw new NotFoundError('Template not found');
  const [draft] = await tx
    .select({ definition: template.draftDefinition })
    .from(template)
    .where(and(eq(template.organizationId, caller.orgId), eq(template.id, row.id)));
  if (!draft) throw new NotFoundError('Template not found');
  const definition = WorkTemplateDefinition.parse(draft.definition);
  const fingerprint = await fingerprintCopyFacts({ definition, offeredTeamIds });
  return {
    identity: {
      kind: 'draft',
      organizationId: OrganizationId.parse(caller.orgId),
      workTypeId: WorkTypeId.parse(row.id),
      draftRevision: row.draftRevision,
      draftFingerprint: fingerprint,
    },
    kind: row.targetType,
    definition,
    fingerprint,
    offeredTeamIds,
  };
}
async function publicationSource(
  tx: TemplateTransaction,
  caller: ActorCtx,
  row: Metadata,
  versionId: string,
  offeredTeamIds: readonly TeamId[],
): Promise<CopyDefinitionSource | null> {
  const [version] = await tx
    .select({ id: workTypeVersion.id, definition: workTypeVersion.definition })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, caller.orgId),
        eq(workTypeVersion.workTypeId, row.id),
        eq(workTypeVersion.id, versionId),
      ),
    );
  if (!version) return null;
  const definition = WorkTemplateDefinition.parse(version.definition),
    archived = row.publicationState === 'archived';
  return {
    identity: {
      kind: 'publication',
      organizationId: OrganizationId.parse(caller.orgId),
      workTypeId: WorkTypeId.parse(row.id),
      workTypeVersionId: WorkTypeVersionId.parse(version.id),
    },
    kind: row.targetType,
    definition,
    offeredTeamIds,
    archived,
    fingerprint: await fingerprintCopyFacts({ definition, offeredTeamIds, archived }),
  };
}
function selectedPublication(
  row: Metadata,
  selection: Extract<Selection, { kind: 'publication' }>,
): string {
  const pin = selection.selection;
  if (pin.kind === 'latest' && row.publicationState === 'archived')
    throw new NotFoundError('Template not found');
  const versionId = pin.kind === 'pinned' ? pin.workTypeVersionId : row.latestPublishedVersionId;
  if (!versionId) throw new NotFoundError('Template not found');
  return versionId;
}
/** Read bodies only after actual source membership and template visibility; caller JSON grants no rights. */
export async function readTenantCopySource(
  tx: TemplateTransaction,
  userId: string,
  selection: Selection,
  allowReservedDraft = false,
): Promise<TenantCopySource> {
  const caller = await loadTemplateCopyActor(
    tx,
    { organizationId: selection.organizationId, userId },
    'view',
  );
  const row = await sourceMetadata(tx, caller, selection.workTypeId);
  const offerings = await tx
    .select({ id: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, caller.orgId), eq(workTypeTeam.workTypeId, row.id)));
  const offeredTeamIds = offerings.map((entry) => TeamId.parse(entry.id)).sort();
  if (selection.kind === 'draft')
    return { source: await draftSource(tx, caller, row, offeredTeamIds) };
  const pin = selection.selection;
  const versionId = selectedPublication(row, selection);
  const source = await publicationSource(tx, caller, row, versionId, offeredTeamIds);
  if (source) return { source };
  if (!allowReservedDraft || pin.kind !== 'pinned') throw new NotFoundError('Template not found');
  const pending = await templateCopyPendingSelection(tx, caller, row.id);
  if (pending?.reservedFirstVersionId !== pin.workTypeVersionId)
    throw new NotFoundError('Template not found');
  const draft = await draftSource(tx, caller, row, offeredTeamIds);
  if (draft.identity.kind !== 'draft') throw new NotFoundError('Template not found');
  return {
    source: draft,
    reservation: {
      organizationId: draft.identity.organizationId,
      workTypeId: draft.identity.workTypeId,
      reservedFirstPublicationId: pin.workTypeVersionId,
      draftRevision: draft.identity.draftRevision,
      draftFingerprint: draft.fingerprint,
    },
  };
}
