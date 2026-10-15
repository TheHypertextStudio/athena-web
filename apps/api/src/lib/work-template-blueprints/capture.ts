import { captureBlueprint, type BlueprintWarning } from '@docket/work/blueprints';
import {
  WorkTemplateCreate,
  WorkTemplateCapturePreview,
  type WorkTemplateCaptureRequest,
  WorkTemplateCaptureResult,
} from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { documentImageIdFromSource, extractDocumentFigures } from '@docket/markdown-tree';
import type { ActorCtx } from '../../context';
import { ConflictError, NotFoundError } from '../../error';
import { ownedDocumentImageIds } from '../../content/drizzle-document-image-reference-storage';
import { loadCreationActor } from '../work-creation/context';
import { requireTemplateAuthor } from '../templates/authorization';
import {
  createWorkTemplateInTransaction,
  reconcileTemplateCreationEffects,
  type TemplateCreationResult,
} from '../templates/service';
import { toWorkTemplateOut } from '../templates/projection';
import type { TemplateTransaction } from '../templates/persistence';
import { serializableTx } from '../serializable-tx';
import { loadBlueprintSnapshot, type AuthorizedBlueprintSnapshot } from './snapshot';
import { blueprintFingerprint } from './fingerprint';
import { captureProgramDefaultSchedules } from '../work-template-default-schedules/capture';

/** Real initiating author, same-tenant root and exactly reviewed source for an independent draft. */
export interface CaptureWorkTemplateCommand {
  readonly actor: ActorCtx;
  readonly kind: TemplateTargetType;
  readonly id: string;
  readonly request: WorkTemplateCaptureRequest;
}
/** Private canonical draft plus deferred effects and warnings; the enclosing owner commits first. */
export interface PrivateTemplateDraftResult extends TemplateCreationResult {
  readonly warnings: readonly BlueprintWarning[];
}

async function requireCaptureImages(
  tx: TemplateTransaction,
  actor: ActorCtx,
  snapshot: AuthorizedBlueprintSnapshot,
): Promise<readonly string[]> {
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    const markdown = node.fields.description;
    if (typeof markdown !== 'string') continue;
    for (const figure of extractDocumentFigures(markdown)) {
      const id = documentImageIdFromSource(figure.src);
      if (!id) continue;
      if (!figure.src.startsWith(`/v1/orgs/${actor.orgId}/images/`))
        throw new NotFoundError('Image not found');
      ids.add(id);
    }
  }
  const owned = await ownedDocumentImageIds(tx, actor.orgId, [...ids]);
  if (owned.size !== ids.size) throw new NotFoundError('Image not found');
  return [...owned].sort();
}

async function reviewedCapture(
  tx: TemplateTransaction,
  actor: ActorCtx,
  kind: TemplateTargetType,
  id: string,
): Promise<WorkTemplateCapturePreview> {
  const live = await loadCreationActor(tx, actor.orgId, actor.actorId);
  await requireTemplateAuthor(live, tx);
  const snapshot = await loadBlueprintSnapshot(
    tx,
    live,
    { kind, id },
    { scope: 'tree', access: 'view', forUpdate: true },
  );
  const images = await requireCaptureImages(tx, live, snapshot);
  const root = snapshot.rowsByRef.get(`${kind}:${id}`);
  if (!root || root.kind === 'milestone') throw new NotFoundError('Work not found');
  const name = root.kind === 'task' ? root.row.title : root.row.name;
  const blueprint = captureBlueprint({
    name,
    root: snapshot.root,
    nodes: snapshot.nodes,
    dependencies: snapshot.dependencies,
    context: snapshot.context,
    complete: true,
  });
  const schedules = await captureProgramDefaultSchedules(tx, live, snapshot);
  const captured = {
    ...blueprint,
    definition: { ...blueprint.definition, defaultSchedules: schedules.defaults },
    warnings: [...blueprint.warnings, ...schedules.warnings],
  };
  return WorkTemplateCapturePreview.parse({
    ...captured,
    descendantCount: snapshot.nodes.length - 1,
    sourceSnapshotToken: blueprintFingerprint({
      organizationId: actor.orgId,
      actorId: actor.actorId,
      kind,
      id,
      source: snapshot.fingerprint,
      captured,
      images,
      scheduleSource: schedules.sourceFingerprint,
    }),
  });
}

/** Preview authorized complete work and review warnings without changing it or publishing a template. */
export async function previewWorkTemplateCapture(
  actor: ActorCtx,
  kind: TemplateTargetType,
  id: string,
): Promise<WorkTemplateCapturePreview> {
  return serializableTx((tx) => reviewedCapture(tx, actor, kind, id));
}

/**
 * Recheck a reviewed source under locks and create an independent author-only draft on this transaction.
 * @throws When source access is revoked, capture is incomplete, images are inaccessible or review is stale.
 */
export async function captureWorkTemplate(
  tx: TemplateTransaction,
  input: CaptureWorkTemplateCommand,
): Promise<PrivateTemplateDraftResult> {
  const captured = await reviewedCapture(tx, input.actor, input.kind, input.id);
  if (captured.sourceSnapshotToken !== input.request.sourceSnapshotToken)
    throw new ConflictError('Source work changed; review its capture again.');
  const live = await loadCreationActor(tx, input.actor.orgId, input.actor.actorId);
  const created = await createWorkTemplateInTransaction(
    tx,
    live,
    WorkTemplateCreate.parse({
      targetType: input.kind,
      scope: 'personal',
      ownerActorId: live.actorId,
      offeredTeamIds: [],
      definition: { ...captured.definition, name: input.request.name },
    }),
    { origin: captured.origin },
  );
  return { ...created, warnings: captured.warnings };
}

/** Save the reviewed capture privately, then drain image effects after the one successful commit. */
export async function saveWorkTemplateCapture(
  input: CaptureWorkTemplateCommand,
): Promise<WorkTemplateCaptureResult> {
  const result = await serializableTx((tx) => captureWorkTemplate(tx, input));
  await reconcileTemplateCreationEffects(result.effects);
  return WorkTemplateCaptureResult.parse({
    template: await toWorkTemplateOut(input.actor, result.row),
    warnings: [...result.warnings],
  });
}
