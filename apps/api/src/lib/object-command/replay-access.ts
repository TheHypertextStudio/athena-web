/** Which resources an undo or redo touches, and what the actor may do to each of them. */
import { canActorBatch, CAPABILITY_RANK, type Capability, type ResourceKind } from '@docket/authz';
import { db } from '@docket/db';
import type { z } from 'zod';

import type {
  ObjectCommandReceipt,
  ObjectCommandReplayAccessResult,
  ObjectCommandValue,
} from '../../contracts/object-command';
import { assertReceiptMatchesDurableChange } from './durable-change';
import { validateReplayReceipt } from './receipt-validator';
import type { CommandEntry, CommandScope } from './types';

/** One resource a replay touches, with the strongest capability that replay demands of it. */
export interface ReplayRequirement {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly capability: Capability;
}

/** Key a requirement by resource so the strongest capability per resource wins. */
export function replayRequirementKey(kind: ResourceKind, id: string): string {
  return `${kind}:${id}`;
}

/** The resource a reference property points at, when moving it needs its own capability. */
export function replayReferenceRequirement(
  objectKind: ObjectCommandReceipt['objectKind'],
  property: string,
  target: ObjectCommandValue,
): ReplayRequirement | null {
  if (target === null) return null;
  const id = String(target);
  if (objectKind === 'task') {
    if (property === 'projectId') return { kind: 'project', id, capability: 'contribute' };
    if (property === 'programId') return { kind: 'program', id, capability: 'contribute' };
    if (property === 'parentTaskId') return { kind: 'task', id, capability: 'contribute' };
    return null;
  }
  if (property === 'teamId') return { kind: 'team', id, capability: 'contribute' };
  if (property === 'programId') return { kind: 'program', id, capability: 'contribute' };
  return null;
}

function entryCapability(receipt: ObjectCommandReceipt, entry: CommandEntry): Capability {
  if (entry.kind !== 'object') return 'contribute';
  if (receipt.objectKind === 'project' && entry.property === 'archivedAt') return 'manage';
  if (entry.property === 'assigneeId' || entry.property === 'leadId') return 'assign';
  return 'contribute';
}

/** Collect every resource a replay in this direction touches, keyed by resource. */
export function replayRequirements(
  receipt: ObjectCommandReceipt,
  direction: 'undo' | 'redo',
): ReadonlyMap<string, ReplayRequirement> {
  const requiredByTarget = new Map<string, ReplayRequirement>();
  const addRequirement = (requirement: ReplayRequirement): void => {
    const key = replayRequirementKey(requirement.kind, requirement.id);
    const current = requiredByTarget.get(key);
    if (
      current === undefined ||
      CAPABILITY_RANK[requirement.capability] > CAPABILITY_RANK[current.capability]
    ) {
      requiredByTarget.set(key, requirement);
    }
  };
  for (const entry of receipt.entries) {
    addRequirement({
      kind: receipt.objectKind,
      id: entry.objectId,
      capability: entryCapability(receipt, entry),
    });
    if (entry.kind === 'relation' && entry.relation === 'dependency') {
      addRequirement({ kind: receipt.objectKind, id: entry.relatedId, capability: 'contribute' });
    }
    if (entry.kind === 'object') {
      const target = direction === 'undo' ? entry.before : entry.after;
      const reference = replayReferenceRequirement(receipt.objectKind, entry.property, target);
      if (reference !== null) addRequirement(reference);
    }
  }
  return requiredByTarget;
}

/** One decision from the batched capability check. */
export type ReplayAccessDecision = Awaited<ReturnType<typeof canActorBatch>>[number];

/** Resolve every requirement with one batched check per capability level. */
export async function replayCapabilityByTarget(
  scope: CommandScope,
  requiredByTarget: ReadonlyMap<string, ReplayRequirement>,
): Promise<ReadonlyMap<string, ReplayAccessDecision>> {
  const { database, orgId, actorId } = scope;
  const capabilityByTarget = new Map<string, ReplayAccessDecision>();
  for (const required of ['contribute', 'assign', 'manage'] as const) {
    const targets = [...requiredByTarget.values()].filter(
      ({ capability }) => capability === required,
    );
    if (targets.length === 0) continue;
    const decisions = await canActorBatch(
      actorId,
      required,
      targets.map(({ kind, id }) => ({ kind, id, orgId })),
      database,
    );
    targets.forEach(({ kind, id }, index) => {
      const decision = decisions[index];
      if (decision) capabilityByTarget.set(replayRequirementKey(kind, id), decision);
    });
  }
  return capabilityByTarget;
}

/** Report whether this actor can still replay a recorded receipt, and which objects block it. */
export async function checkReplayAccess(
  orgId: string,
  actorId: string,
  direction: 'undo' | 'redo',
  receipt: ObjectCommandReceipt,
): Promise<z.input<typeof ObjectCommandReplayAccessResult>> {
  const scope: CommandScope = { database: db, orgId, actorId };
  validateReplayReceipt(receipt);
  await assertReceiptMatchesDurableChange(scope, receipt);
  const requiredByTarget = replayRequirements(receipt, direction);
  const capabilityByTarget = await replayCapabilityByTarget(scope, requiredByTarget);
  const deniedIds = [
    ...new Set(
      [...requiredByTarget.values()]
        .filter(({ kind, id }) => !capabilityByTarget.get(replayRequirementKey(kind, id))?.allow)
        .map(({ id }) => id),
    ),
  ];
  return { allowed: deniedIds.length === 0, deniedIds };
}
