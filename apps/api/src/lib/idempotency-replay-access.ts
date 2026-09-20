/** Reauthorization for atomically replayed object-command receipts. */
import { CAPABILITY_RANK, satisfies, type Capability } from '@docket/authz';
import { actor, db, label } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  ObjectCommandRequest,
  ObjectCommandResult,
  type ObjectCommandReceipt,
  type ObjectCommandRequest as ObjectCommandRequestValue,
  type ObjectCommandResult as ObjectCommandResultValue,
} from '../contracts/object-command';
import { CapabilityError, NotFoundError } from '../error';
import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
} from '../permissions/resource-access';

interface ReplayResourceRequirement {
  readonly ref: ResourceAccessRef;
  readonly capability: Capability;
}

type RequirementMap = Map<string, ReplayResourceRequirement>;
type ReceiptEntry = ObjectCommandReceipt['entries'][number];

function receiptReferenceKind(
  objectKind: 'task' | 'project',
  property: string,
): ResourceAccessRef['kind'] | null {
  if (objectKind === 'task') {
    if (property === 'projectId') return 'project';
    if (property === 'programId') return 'program';
    if (property === 'parentTaskId') return 'task';
    return null;
  }
  if (property === 'teamId') return 'team';
  if (property === 'programId') return 'program';
  return null;
}

function receiptObjectCapability(
  objectKind: 'task' | 'project',
  action: string,
  property?: string,
): Capability {
  if (objectKind === 'project' && (action === 'trash' || action === 'restore')) return 'manage';
  if (objectKind === 'project' && property === 'archivedAt') return 'manage';
  if (property === 'assigneeId' || property === 'leadId') return 'assign';
  return 'contribute';
}

function addRequirement(
  requirements: RequirementMap,
  ref: ResourceAccessRef,
  capability: Capability,
): void {
  const key = resourceAccessKey(ref);
  const current = requirements.get(key);
  if (current === undefined || CAPABILITY_RANK[capability] > CAPABILITY_RANK[current.capability]) {
    requirements.set(key, { ref, capability });
  }
}

function capabilityByObject(receipt: ObjectCommandReceipt): ReadonlyMap<string, Capability> {
  const capabilities = new Map<string, Capability>();
  for (const entry of receipt.entries) {
    const required = receiptObjectCapability(
      receipt.objectKind,
      receipt.action,
      entry.kind === 'object' ? entry.property : undefined,
    );
    const current = capabilities.get(entry.objectId);
    if (current === undefined || CAPABILITY_RANK[required] > CAPABILITY_RANK[current]) {
      capabilities.set(entry.objectId, required);
    }
  }
  return capabilities;
}

function addResultRequirements(
  result: ObjectCommandResultValue,
  organizationId: string,
  requirements: RequirementMap,
): void {
  const receipt = result.receipt;
  const capabilities = capabilityByObject(receipt);
  for (const id of [...result.appliedIds, ...result.conflictingIds, ...result.deniedIds]) {
    addRequirement(
      requirements,
      { organizationId, kind: receipt.objectKind, id },
      capabilities.get(id) ?? receiptObjectCapability(receipt.objectKind, receipt.action),
    );
  }
}

function relatedReceiptRequirement(
  entry: Exclude<ReceiptEntry, { kind: 'object' }>,
): { readonly capability: Capability; readonly kind: ResourceAccessRef['kind'] } | null {
  if (entry.relation === 'dependency') return { capability: 'contribute', kind: 'task' };
  if (entry.relation === 'initiative') return { capability: 'view', kind: 'initiative' };
  return null;
}

function addObjectEntryReferences(
  entry: Extract<ReceiptEntry, { kind: 'object' }>,
  objectKind: ObjectCommandReceipt['objectKind'],
  organizationId: string,
  requirements: RequirementMap,
): void {
  const kind = receiptReferenceKind(objectKind, entry.property);
  if (kind === null) return;
  for (const value of [entry.before, entry.after]) {
    if (typeof value === 'string') {
      addRequirement(requirements, { organizationId, kind, id: value }, 'view');
    }
  }
}

function addRelationEntryReference(
  entry: Exclude<ReceiptEntry, { kind: 'object' }>,
  objectKind: ObjectCommandReceipt['objectKind'],
  organizationId: string,
  requirements: RequirementMap,
): boolean {
  const related = relatedReceiptRequirement(entry);
  if (!related) return false;
  const kind = entry.relation === 'dependency' ? objectKind : related.kind;
  addRequirement(requirements, { organizationId, kind, id: entry.relatedId }, related.capability);
  return true;
}

function addReceiptEntryRequirements(
  receipt: ObjectCommandReceipt,
  organizationId: string,
  requirements: RequirementMap,
): readonly string[] {
  const labelIds: string[] = [];
  for (const entry of receipt.entries) {
    addRequirement(
      requirements,
      { organizationId, kind: receipt.objectKind, id: entry.objectId },
      receiptObjectCapability(
        receipt.objectKind,
        receipt.action,
        entry.kind === 'object' ? entry.property : undefined,
      ),
    );
    if (entry.kind === 'object') {
      addObjectEntryReferences(entry, receipt.objectKind, organizationId, requirements);
      continue;
    }
    if (!addRelationEntryReference(entry, receipt.objectKind, organizationId, requirements)) {
      labelIds.push(entry.relatedId);
    }
  }
  return labelIds;
}

function addReplayRequestRequirements(
  request: Extract<ObjectCommandRequestValue, { direction: unknown }>,
  organizationId: string,
  requirements: RequirementMap,
): void {
  for (const entry of request.receipt.entries) {
    addRequirement(
      requirements,
      { organizationId, kind: request.receipt.objectKind, id: entry.objectId },
      receiptObjectCapability(
        request.receipt.objectKind,
        request.receipt.action,
        entry.kind === 'object' ? entry.property : undefined,
      ),
    );
    if (entry.kind === 'relation' && entry.relation === 'dependency') {
      addRequirement(
        requirements,
        { organizationId, kind: request.receipt.objectKind, id: entry.relatedId },
        'contribute',
      );
    }
    if (entry.kind !== 'object') continue;
    const kind = receiptReferenceKind(request.receipt.objectKind, entry.property);
    const target = request.direction === 'undo' ? entry.before : entry.after;
    if (kind !== null && typeof target === 'string') {
      addRequirement(requirements, { organizationId, kind, id: target }, 'contribute');
    }
  }
}

function forwardObjectCapability(
  request: Extract<ObjectCommandRequestValue, { objectIds: unknown }>,
): Capability {
  const operation = request.operation;
  if (
    request.objectKind === 'project' &&
    (operation.type === 'trash' || operation.type === 'restore')
  ) {
    return 'manage';
  }
  if (
    operation.type === 'replace_property' &&
    (operation.property === 'assigneeId' || operation.property === 'leadId')
  ) {
    return 'assign';
  }
  return 'contribute';
}

function addForwardRequestRequirements(
  request: Extract<ObjectCommandRequestValue, { objectIds: unknown }>,
  organizationId: string,
  requirements: RequirementMap,
): void {
  const required = forwardObjectCapability(request);
  for (const id of request.objectIds) {
    addRequirement(requirements, { organizationId, kind: request.objectKind, id }, required);
  }
  const operation = request.operation;
  if (operation.type === 'add_dependency' || operation.type === 'remove_dependency') {
    for (const id of [operation.blockingId, operation.blockedId]) {
      addRequirement(requirements, { organizationId, kind: request.objectKind, id }, 'contribute');
    }
  }
  if (operation.type === 'change_parent' && operation.parentId !== null) {
    addRequirement(
      requirements,
      { organizationId, kind: 'task', id: operation.parentId },
      'contribute',
    );
  }
  if (operation.type !== 'replace_property' || typeof operation.value !== 'string') return;
  const kind = receiptReferenceKind(request.objectKind, operation.property);
  if (kind !== null) {
    addRequirement(requirements, { organizationId, kind, id: operation.value }, 'contribute');
  }
}

function addRequestRequirements(
  body: string,
  organizationId: string,
  requirements: RequirementMap,
): void {
  let parsed: ReturnType<typeof ObjectCommandRequest.safeParse>;
  try {
    parsed = ObjectCommandRequest.safeParse(JSON.parse(body));
  } catch {
    return;
  }
  if (!parsed.success) return;
  if ('direction' in parsed.data) {
    addReplayRequestRequirements(parsed.data, organizationId, requirements);
  } else {
    addForwardRequestRequirements(parsed.data, organizationId, requirements);
  }
}

async function requireActiveMembership(userId: string, organizationId: string): Promise<void> {
  const memberships = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, organizationId),
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!memberships[0]) throw new NotFoundError('Object command result not found');
}

async function requireResourceAccess(userId: string, requirements: RequirementMap): Promise<void> {
  const unique = [...requirements.values()];
  const accessByResource = await resolveResourceAccess(
    userId,
    unique.map(({ ref }) => ref),
  );
  for (const requirement of unique) {
    const access = accessByResource.get(resourceAccessKey(requirement.ref));
    if (!access?.canView || access.effectiveCapability === null) {
      throw new NotFoundError('Object command result not found');
    }
    if (!satisfies(access.effectiveCapability, requirement.capability)) {
      throw new CapabilityError();
    }
  }
}

async function requireLabels(organizationId: string, labelIds: readonly string[]): Promise<void> {
  const ids = [...new Set(labelIds)];
  if (ids.length === 0) return;
  const current = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.organizationId, organizationId), inArray(label.id, ids)));
  if (current.length !== ids.length) throw new NotFoundError('Object command result not found');
}

/** Require every permission the live object command would require before replaying its result. */
export async function assertCurrentObjectCommandReplayAccess(
  userId: string,
  path: string,
  organizationId: string | null,
  requestBody: string,
  responseBody: unknown,
): Promise<void> {
  const result = ObjectCommandResult.safeParse(responseBody);
  const pathOrganizationId = /^\/v1\/orgs\/([^/]+)\/object-commands$/u.exec(path)?.[1] ?? null;
  if (!result.success || organizationId === null || pathOrganizationId !== organizationId) {
    throw new NotFoundError('Object command result not found');
  }
  await requireActiveMembership(userId, organizationId);
  const requirements: RequirementMap = new Map();
  addResultRequirements(result.data, organizationId, requirements);
  const labelIds = addReceiptEntryRequirements(result.data.receipt, organizationId, requirements);
  addRequestRequirements(requestBody, organizationId, requirements);
  await requireResourceAccess(userId, requirements);
  await requireLabels(organizationId, labelIds);
}
