import { recoverRetainedRootResolution } from '@docket/db';
import type { ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedRootBinding,
  type AuthorizedRetainedOccurrence,
  type RetainedOccurrenceWork,
} from '../work-creation/retained-authority';
import { readBlueprintWork } from './snapshot-rows';
import type { BlueprintSelection } from './resolve';
import { requireScheduleRootBinding } from '../recurrence/schedule-authority';
import type { OrdinaryWorkCommand } from '../work-creation/types';

/** Opaque occurrence/root capability; only the checked actual mapped root can freeze a manifest. */
export interface RetainedBlueprintResolutionProof {
  readonly proof: object;
}
interface CheckedResolution {
  readonly tx: TemplateTransaction;
  readonly binding?: RetainedRootBinding;
  readonly scheduleCommand?: OrdinaryWorkCommand;
  readonly selection: BlueprintSelection;
  readonly manifest: readonly ResolvedVersionAtPath[];
}
const checked = new WeakMap<RetainedBlueprintResolutionProof, CheckedResolution>();

/** Convert an exact persisted native occurrence capability into this resolver's transaction proof. */
export function loadScheduleBlueprintResolutionProof(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): RetainedBlueprintResolutionProof | undefined {
  const root = requireScheduleRootBinding(tx, command);
  if (!root) return undefined;
  const proof = Object.freeze({ proof: {} });
  checked.set(proof, {
    tx,
    scheduleCommand: command,
    selection: {
      organizationId: command.caller.orgId,
      kind: root.kind,
      workTypeId: root.workTypeId,
      workTypeVersionId: root.versionId,
    },
    manifest: root.resolvedManifest,
  });
  return proof;
}

async function originalAcceptedManifest(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  selected: AuthorizedRetainedOccurrence['manifest']['roots'][number],
  mapped: RetainedOccurrenceWork,
): Promise<readonly ResolvedVersionAtPath[] | undefined> {
  const ref = facts.rootRefs.find(
    (root) =>
      root.key === selected.sourceKey && root.kind === selected.kind && root.id === mapped.id,
  );
  const manifest =
    ref?.resolvedManifest ??
    (facts.appliedAt
      ? await recoverRetainedRootResolution(tx, {
          organizationId: facts.organizationId,
          occurrenceId: facts.occurrenceId,
          invocationId: facts.invocationId,
          sourceKey: selected.sourceKey,
          kind: selected.kind,
          workId: mapped.id,
        })
      : undefined);
  if (!manifest && facts.appliedAt)
    throw new ConflictError('The original accepted recurrence closure is unavailable.');
  return manifest;
}

/**
 * Load the private original closure or exact original recurrence receipt under checked authority.
 * An unapplied root without a prior acceptance resolves its first closure normally.
 * @throws For a forged binding, foreign root, changed original selection or inconsistent manifest.
 */
export async function loadRetainedBlueprintResolutionProof(
  tx: TemplateTransaction,
  binding: RetainedRootBinding,
): Promise<RetainedBlueprintResolutionProof | undefined> {
  const facts = requireRetainedOccurrenceAuthority(tx, binding.authority);
  const selected = facts.manifest.roots.find((root) => root.key === binding.rootKey);
  if (!selected) throw new CapabilityError();
  const mapped = facts.mappedWork.get(selected.sourceStepId);
  if (!mapped) return undefined;
  if (mapped.kind !== selected.kind || mapped.rootKey !== selected.key)
    throw new ConflictError('Retained root mapping changed');
  await readBlueprintWork(tx, facts.organizationId, {
    kind: selected.kind,
    id: mapped.id,
  });
  const manifest = await originalAcceptedManifest(tx, facts, selected, mapped);
  if (!manifest) return undefined;
  const selection: BlueprintSelection = {
    organizationId: facts.organizationId,
    kind: selected.kind,
    workTypeId: selected.workTypeId ?? undefined,
    workTypeVersionId: selected.workTypeVersionId ?? undefined,
  };
  const root = manifest.find((entry) => entry.path.length === 0);
  if (!root) throw new ConflictError('Retained root publication changed');
  if (root.workTypeId !== selection.workTypeId || root.versionId !== selection.workTypeVersionId)
    throw new ConflictError('Retained root publication changed');
  const proof = Object.freeze({ proof: {} });
  checked.set(proof, { tx, binding, selection, manifest });
  return proof;
}

/** Validate exact transaction, occurrence and original root selection before using accepted versions. */
export function retainedResolutionManifest(
  tx: TemplateTransaction,
  selection: BlueprintSelection,
  proof: RetainedBlueprintResolutionProof,
): readonly ResolvedVersionAtPath[] {
  const facts = checked.get(proof);
  if (
    facts?.tx !== tx ||
    facts.selection.organizationId !== selection.organizationId ||
    facts.selection.kind !== selection.kind ||
    facts.selection.workTypeId !== selection.workTypeId ||
    facts.selection.workTypeVersionId !== selection.workTypeVersionId
  )
    throw new CapabilityError();
  if (facts.scheduleCommand) requireScheduleRootBinding(tx, facts.scheduleCommand);
  else if (facts.binding) requireRetainedOccurrenceAuthority(tx, facts.binding.authority);
  else throw new CapabilityError();
  return facts.manifest;
}
