import { createHash } from 'node:crypto';
import { actor } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type LabelTemplateConversionChoices,
  LabelTemplateConversionReview,
} from '@docket/work/work-template-contract';
import type { TemplateTransaction } from '../templates/persistence';
import { requireTemplateAuthor, requireTemplateTeam } from '../templates/authorization';
import { assertProductCapability } from '../../product-capability';
import { NotFoundError, ValidationError } from '../../error';
import { requireLabelGroup } from '../label-catalog';
import { labelsForSubject, resolveLabelCatalog } from '../labels';
import { prepareTemplateIdentityOnly } from '../work-template-blueprints/selective-identity';
import type { ActorCtx } from '../../context';
import { installTemplateCopyContext } from '../templates/copy-reservation-context';

/** Persisted human identity from the session middleware, never client JSON. */
export interface ConversionReviewer {
  readonly orgId: string;
  readonly actorId: string;
  readonly userId: string;
}
/** Current human membership is required even for terminal receipt reconciliation. */
export async function requireConversionReviewer(
  tx: TemplateTransaction,
  caller: ConversionReviewer,
): Promise<ActorCtx> {
  const [member] = await tx
    .select({ id: actor.id, roleId: actor.roleId })
    .from(actor)
    .where(
      and(
        eq(actor.id, caller.actorId),
        eq(actor.organizationId, caller.orgId),
        eq(actor.userId, caller.userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!member) throw new NotFoundError();
  await installTemplateCopyContext(tx, caller);
  return { orgId: caller.orgId, actorId: member.id, roleId: member.roleId, capabilities: [] };
}
/** Stable fingerprint of exact checked facts; a digest never grants read or write authority. */
export function conversionFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
/** Validate every selected identity and label set without applying any starting values or child changes. */
export async function prepareLabelTemplateConversion(
  tx: TemplateTransaction,
  caller: ConversionReviewer,
  choices: LabelTemplateConversionChoices,
) {
  const live = await requireConversionReviewer(tx, caller);
  await assertProductCapability(caller.orgId, 'athena', tx);
  await requireTemplateAuthor({ orgId: caller.orgId, actorId: caller.actorId }, tx);
  const group = await requireLabelGroup(caller.orgId, choices.labelGroupId, tx);
  if (group.teamId) await requireTemplateTeam(caller, group.teamId, tx);
  const prepared = [];
  const sorted = [...choices.items].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
  for (const item of sorted) {
    const identity = await prepareTemplateIdentityOnly(tx, live, item.kind, {
      id: item.id,
      selection: { workTypeId: item.workTypeId, workTypeVersionId: item.workTypeVersionId },
    });
    const currentLabels = await labelsForSubject(item.kind, caller.orgId, item.id, tx);
    const catalog = await resolveLabelCatalog(caller.orgId, item.removeLabelIds, tx);
    if (
      item.removeLabelIds.some(
        (id) =>
          !currentLabels.some((label) => label.id === id) ||
          !catalog.some((label) => label.id === id && label.groupId === group.id),
      )
    )
      throw new ValidationError([
        { path: ['items'], message: 'Choose only attached labels from this group.' },
      ]);
    prepared.push({
      item,
      identity,
      currentLabels,
      removeLabels: currentLabels.filter((label) =>
        item.removeLabelIds.some((id) => id === label.id),
      ),
    });
  }
  const review = LabelTemplateConversionReview.parse({
    labelGroupId: group.id,
    labelGroupName: group.name,
    reviewFingerprint: conversionFingerprint({
      group,
      choices,
      facts: prepared.map((value) => ({
        row: value.identity.before.row,
        labels: value.currentLabels,
        publication: value.identity.version,
      })),
    }),
    items: prepared.map(({ item, identity, removeLabels }) => ({
      kind: item.kind,
      id: item.id,
      name: 'title' in identity.before.row ? identity.before.row.title : identity.before.row.name,
      templateName: identity.version.definition.name,
      workTypeId: item.workTypeId,
      workTypeVersionId: identity.version.id,
      removeLabels: removeLabels.map(({ id, name }) => ({ id, name })),
    })),
  });
  return { review, prepared };
}
