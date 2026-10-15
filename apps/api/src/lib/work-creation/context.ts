import { canActor, satisfies, type Capability } from '@docket/authz';
import {
  actor,
  organization,
  role,
  recurrenceSeries,
  recurrenceSeriesRevision,
  type Database,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import type { TemplateTransaction } from '../templates/persistence';
import { CapabilityError, NotFoundError, ValidationError } from '../../error';
import { assertSharedWorkWritable } from '../../product-capability';
import type {
  OrdinaryWorkCommand,
  WorkCreationBatchCommand,
  TrustedCreationAuthority,
} from './types';

/** Validate the trusted forest's authority and explicit row budget before any write. */
export function validateCreationBatch(command: WorkCreationBatchCommand): number {
  const first = command.roots[0];
  if (!first) throw new ValidationError([{ path: ['roots'], message: 'Choose work to create.' }]);
  const keys = new Set<string>();
  let count = 0;
  for (const root of command.roots) {
    if (keys.has(root.key))
      throw new ValidationError([{ path: ['roots'], message: 'Root keys must be unique.' }]);
    keys.add(root.key);
    if (
      root.command.caller.orgId !== first.command.caller.orgId ||
      root.command.caller.actorId !== first.command.caller.actorId
    ) {
      throw new ValidationError([
        { path: ['roots'], message: 'Create work under one workspace and initiating authority.' },
      ]);
    }
    count +=
      1 + (root.command.kind === 'project' ? (root.command.body.milestones?.length ?? 0) : 0);
  }
  if (count > 500)
    throw new ValidationError([
      { path: ['roots'], message: 'Create at most 500 work items including milestones.' },
    ]);
  validateBatchEdges(command);
  return count;
}

function validateBatchEdges(command: WorkCreationBatchCommand): void {
  if (command.edges.length > 2000)
    throw new ValidationError([{ path: ['edges'], message: 'Choose at most 2000 dependencies.' }]);
  const roots = new Map(command.roots.map((root) => [root.key, root.command]));
  const seen = new Set<string>();
  for (const edge of command.edges) {
    const blocker = roots.get(edge.blocker.rootKey);
    const blocked = roots.get(edge.blocked.rootKey);
    const identity = JSON.stringify(edge);
    if (
      edge.blocker.path.length > 499 ||
      edge.blocked.path.length > 499 ||
      invalidTaskEndpoint(blocker, edge.blocker.path) ||
      invalidTaskEndpoint(blocked, edge.blocked.path) ||
      JSON.stringify(edge.blocker) === JSON.stringify(edge.blocked) ||
      seen.has(identity)
    ) {
      throw new ValidationError([
        { path: ['edges'], message: 'Dependencies must join distinct known tasks once.' },
      ]);
    }
    seen.add(identity);
  }
  validateDependencyDag(command);
}

function invalidTaskEndpoint(
  command: OrdinaryWorkCommand | undefined,
  path: readonly string[],
): boolean {
  return !command || (path.length === 0 && command.kind !== 'task');
}

function validateDependencyDag(command: WorkCreationBatchCommand): void {
  const outgoing = new Map<string, string[]>();
  for (const edge of command.edges) {
    const from = JSON.stringify(edge.blocker),
      to = JSON.stringify(edge.blocked);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const done = new Set<string>();
  const open = new Set<string>();
  const visit = (key: string): void => {
    if (done.has(key)) return;
    if (open.has(key))
      throw new ValidationError([
        { path: ['edges'], message: 'Dependencies cannot form a cycle.' },
      ]);
    open.add(key);
    for (const next of outgoing.get(key) ?? []) visit(next);
    open.delete(key);
    done.add(key);
  };
  for (const key of outgoing.keys()) visit(key);
}

/** Check the real initiating actor and shared-work policy on the caller's transaction. */
export async function authorizeOrdinaryCreation(
  database: Database,
  command: OrdinaryWorkCommand,
): Promise<void> {
  const { caller } = command;
  if (caller.actorId === null) {
    if (
      !validRetainedAuthority(database, caller) ||
      command.invocation.origin.channel !== 'rule' ||
      command.invocation.origin.surface !== 'recurrence'
    )
      throw new CapabilityError();
    await assertSharedWorkWritable(caller.orgId, undefined, database);
    return;
  }

  const live = await loadCreationActor(database, caller.orgId, caller.actorId);
  const required = command.kind === 'program' ? 'manage' : 'contribute';
  if (!live.capabilities.some((capability) => satisfies(capability as Capability, required))) {
    const decision = await canActor(
      live.actorId,
      required,
      { kind: 'organization', id: live.orgId, orgId: live.orgId },
      database,
    );
    if (!decision.allow) {
      if (decision.effectiveCapability === null) throw new NotFoundError('Workspace not found');
      throw new CapabilityError();
    }
  }
  await assertSharedWorkWritable(caller.orgId, live.isPersonal, database);
}

const retainedAuthorityTransactions = new WeakMap<
  object,
  { database: Database; authority: TrustedCreationAuthority }
>();

function validRetainedAuthority(database: Database, caller: TrustedCreationAuthority): boolean {
  const checked = retainedAuthorityTransactions.get(caller.proof);
  return checked?.database === database && checked.authority === caller;
}

/** Load actual persisted actor/tenant-role context for a foreground plan or MCP adapter. */
export async function loadCreationActor(
  tx: Database,
  orgId: string,
  actorId: string,
): Promise<ActorCtx> {
  const [row] = await tx
    .select({ actor, role, isPersonal: organization.isPersonal })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, orgId)))
    .where(
      and(
        eq(actor.id, actorId),
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Workspace not found');
  return {
    orgId,
    actorId: row.actor.id,
    roleId: row.actor.roleId,
    capabilities: row.role?.capabilities ?? [],
    isPersonal: row.isPersonal,
  };
}

/** Authorize an active retained recurrence binding whose creating member no longer exists. */
export async function authorizeRetainedRecurrence(
  tx: TemplateTransaction,
  orgId: string,
  binding: TrustedCreationAuthority['binding'],
): Promise<TrustedCreationAuthority> {
  const [row] = await tx
    .select({ id: recurrenceSeries.id })
    .from(recurrenceSeries)
    .innerJoin(
      recurrenceSeriesRevision,
      and(
        eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
        eq(recurrenceSeriesRevision.organizationId, orgId),
      ),
    )
    .where(
      and(
        eq(recurrenceSeries.id, binding.seriesId),
        eq(recurrenceSeries.organizationId, orgId),
        eq(recurrenceSeriesRevision.id, binding.revisionId),
        eq(recurrenceSeries.status, 'active'),
        isNull(recurrenceSeries.createdBy),
        isNull(recurrenceSeries.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Recurrence binding not found');
  await assertSharedWorkWritable(orgId, undefined, tx);
  const proof = {};
  const authority = Object.freeze({
    kind: 'retained-recurrence' as const,
    orgId,
    actorId: null,
    binding: Object.freeze({ ...binding }),
    proof,
  });
  retainedAuthorityTransactions.set(proof, { database: tx, authority });
  return authority;
}
