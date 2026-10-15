import { CapabilityError, NotFoundError, ValidationError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { authorizeOrdinaryCreation } from './context';
import type {
  OrdinaryPreparationContext,
  OrdinaryWorkCommand,
  ProspectiveWorkReference,
  AuthorizedPublishedChild,
} from './types';

interface CheckedPreparationContext {
  readonly tx: TemplateTransaction;
  readonly context: OrdinaryPreparationContext;
  inherited?: OrdinaryPreparationContext;
}
const checkedContexts = new WeakMap<object, CheckedPreparationContext>();

/** Bind server-allocated, bounded planner references to their checked root authority and privacy. */
export async function createOrdinaryPreparationContext(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  rows: readonly ProspectiveWorkReference[],
  rootVisibility: 'public' | 'private',
  children: readonly AuthorizedPublishedChild[] = [],
): Promise<OrdinaryPreparationContext> {
  await authorizeOrdinaryCreation(tx, command);
  if (rows.length > 500)
    throw new ValidationError([{ path: ['blueprint'], message: 'Create at most 500 work items.' }]);
  const prospective = prospectiveReferences(command, rows, rootVisibility);
  const publishedChildren = new Map<string, AuthorizedPublishedChild>();
  for (const child of children) {
    if (
      prospective.get(child.prospectiveWorkId)?.kind !== child.kind ||
      publishedChildren.has(child.prospectiveWorkId)
    )
      throw new CapabilityError();
    publishedChildren.set(child.prospectiveWorkId, Object.freeze({ ...child }));
  }
  const proof = {};
  const context = Object.freeze({
    orgId: command.caller.orgId,
    actorId: command.caller.actorId,
    rootVisibility,
    publishedChildren,
    prospective,
    proof,
  });
  checkedContexts.set(proof, { tx, context });
  return context;
}

/** Recognize only exact prospective work references; teams, actors, cycles and labels never use it. */
export function prospectiveWorkReference(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context: OrdinaryPreparationContext | undefined,
  kind: ProspectiveWorkReference['kind'],
  id: string | null | undefined,
): ProspectiveWorkReference | undefined {
  let current = context;
  while (current) {
    const checked = requireCheckedContext(tx, command, current);
    if (!id) return undefined;
    const row = current.prospective.get(id);
    if (row && row.kind !== kind) throw new NotFoundError('Work not found');
    if (row) return row;
    current = checked.inherited;
  }
  return undefined;
}

function requireCheckedContext(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context: OrdinaryPreparationContext,
): CheckedPreparationContext {
  const checked = checkedContexts.get(context.proof);
  if (
    checked?.tx !== tx ||
    checked.context !== context ||
    context.orgId !== command.caller.orgId ||
    context.actorId !== command.caller.actorId
  )
    throw new CapabilityError();
  return checked;
}

/**
 * Retain exact authorized external parents without copying them into a differently private child map.
 * @throws {CapabilityError} For forged, foreign, cross-transaction, replaced, or cyclic inheritance.
 */
export function inheritOrdinaryPreparationContext(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context: OrdinaryPreparationContext,
  inherited: OrdinaryPreparationContext,
): void {
  const checked = requireCheckedContext(tx, command, context);
  if (checked.inherited && checked.inherited !== inherited) throw new CapabilityError();
  let current: OrdinaryPreparationContext | undefined = inherited;
  const seen = new Set<OrdinaryPreparationContext>([context]);
  while (current) {
    if (seen.has(current) || seen.size > 500) throw new CapabilityError();
    seen.add(current);
    current = requireCheckedContext(tx, command, current).inherited;
  }
  checked.inherited = inherited;
}

function prospectiveReferences(
  command: OrdinaryWorkCommand,
  rows: readonly ProspectiveWorkReference[],
  rootVisibility: 'public' | 'private',
): ReadonlyMap<string, ProspectiveWorkReference> {
  const prospective = new Map<string, ProspectiveWorkReference>();
  for (const row of rows) {
    if (!row.id || row.orgId !== command.caller.orgId || prospective.has(row.id))
      throw new CapabilityError();
    if (rootVisibility === 'private' && 'visibility' in row && row.visibility !== 'private')
      throw new CapabilityError();
    prospective.set(row.id, Object.freeze({ ...row }));
  }
  return prospective;
}
