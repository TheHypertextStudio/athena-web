/**
 * Test helpers for hub-aggregation.test.ts.
 *
 * @remarks
 * Extracted to reduce file complexity. Contains setup utilities, data builders,
 * and response type definitions.
 */

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

/** Parse JSON response body. */
export async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Next Monday in UTC (`YYYY-MM-DD` format), never today. */
export function nextMonday(): string {
  const now = new Date();
  const daysUntilMonday = (1 - now.getUTCDay() + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

/** Insert a user + its hub; returns ids. */
export async function seedUserWithHub(schema: typeof DbModule, db: typeof DbModule.db) {
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `hub-${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: assertDefined(user).id })
    .returning({ id: schema.hub.id });
  return { userId: assertDefined(user).id, hubId: assertDefined(h).id };
}

interface JoinOrgOptions {
  readonly status?: 'active' | 'suspended';
  readonly roleId?: string | null;
}

/** Make `userId` an active human Actor in `orgId`; returns the actor id. */
export async function joinOrg(
  schema: typeof DbModule,
  db: typeof DbModule.db,
  userId: string,
  orgId: string,
  { status = 'active', roleId = null }: JoinOrgOptions = {},
) {
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, status, roleId })
    .returning({ id: schema.actor.id });
  return assertDefined(a).id;
}

/** Join through a role that matches the normal Member write capability. */
export async function joinContributingOrg(
  schema: typeof DbModule,
  db: typeof DbModule.db,
  userId: string,
  orgId: string,
): Promise<string> {
  const [memberRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: `member-${Math.random().toString(36).slice(2)}`,
      name: `Member ${Math.random().toString(36).slice(2)}`,
      capabilities: ['contribute'],
    })
    .returning({ id: schema.role.id });
  return joinOrg(schema, db, userId, orgId, {
    roleId: assertDefined(memberRole).id,
  });
}

/** Create a search route object. */
export function searchRoute(orgId: string, kind: string, id: string) {
  return {
    type: 'entity' as const,
    organizationId: orgId,
    entityKind: kind,
    entityId: id,
    href: `/orgs/${orgId}/search?id=${id}`,
  };
}
