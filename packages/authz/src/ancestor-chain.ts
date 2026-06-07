/**
 * `@docket/authz` — containment ancestor-chain resolver.
 *
 * @remarks
 * A grant cascades down containment, so resolving an actor's capability on a target
 * means collecting the grants attached to the target OR any of its ancestors. This
 * walks the FK chain (task → project/program/team → organization) and always ends at
 * the organization root (where role-base grants are materialized).
 */
import type { Database } from '@docket/db';
import { project, task } from '@docket/db';
import { eq } from 'drizzle-orm';

/** A containment node kind. */
export type ResourceKind =
  | 'organization'
  | 'team'
  | 'initiative'
  | 'program'
  | 'project'
  | 'cycle'
  | 'task';

/** A reference to a containment node (kind + id + owning org). */
export interface ResourceRef {
  /** The node kind. */
  readonly kind: ResourceKind;
  /** The node id. */
  readonly id: string;
  /** The owning organization id. */
  readonly orgId: string;
}

/**
 * Build the containment chain for `target`: the target itself, its FK ancestors, and
 * the organization root.
 *
 * @param target - The resource to resolve.
 * @param db - The database client.
 * @returns the chain from most-specific to the organization root.
 */
export async function ancestorChain(target: ResourceRef, db: Database): Promise<ResourceRef[]> {
  const org: ResourceRef = { kind: 'organization', id: target.orgId, orgId: target.orgId };
  if (target.kind === 'organization') return [org];

  const chain: ResourceRef[] = [target];

  if (target.kind === 'task') {
    const rows = await db.select().from(task).where(eq(task.id, target.id)).limit(1);
    const t = rows[0];
    if (t) {
      chain.push({ kind: 'team', id: t.teamId, orgId: target.orgId });
      if (t.projectId) chain.push({ kind: 'project', id: t.projectId, orgId: target.orgId });
      if (t.programId) chain.push({ kind: 'program', id: t.programId, orgId: target.orgId });
    }
  } else if (target.kind === 'project') {
    const rows = await db.select().from(project).where(eq(project.id, target.id)).limit(1);
    const p = rows[0];
    if (p) {
      if (p.teamId) chain.push({ kind: 'team', id: p.teamId, orgId: target.orgId });
      if (p.programId) chain.push({ kind: 'program', id: p.programId, orgId: target.orgId });
    }
  }

  chain.push(org);
  return chain;
}
