import { createHash } from 'node:crypto';

import { actor, db, demo, demoWorkspace, serviceControl, user } from '@docket/db';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { consumeDemoBudget } from './demo-budget';

import type { DemoLinkCredential } from './demo-link';

/**
 * Resolve a private link only to an existing active member of its provisioned demo workspace.
 * @param credential - The demo slug, designated email and random bearer secret.
 * @returns The provisioned user ID, or null for every refused credential/access state.
 */
export async function resolveDemoSignIn(credential: DemoLinkCredential): Promise<string | null> {
  const email = credential.email.trim().toLowerCase();
  const digest = createHash('sha256')
    .update(`${credential.slug}\n${email}\n${credential.token}`)
    .digest('hex');
  const [control] = await db
    .select({ enabled: serviceControl.enabled })
    .from(serviceControl)
    .where(eq(serviceControl.key, 'demo_sign_in'))
    .limit(1);
  if (control && !control.enabled) return null;
  const [found] = await db
    .select({ userId: user.id })
    .from(demo)
    .innerJoin(demoWorkspace, eq(demoWorkspace.demoId, demo.id))
    .innerJoin(actor, eq(actor.organizationId, demoWorkspace.organizationId))
    .innerJoin(user, eq(user.id, actor.userId))
    .where(
      and(
        eq(demo.slug, credential.slug),
        eq(demo.status, 'active'),
        eq(demo.signInTokenHash, digest),
        or(isNull(demo.expiresAt), gt(demo.expiresAt, new Date())),
        or(isNull(demoWorkspace.expiresAt), gt(demoWorkspace.expiresAt, new Date())),
        sql`${email} = any(${demo.allowedEmails})`,
        eq(user.email, email),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  if (!found) return null;
  await consumeDemoBudget({ userId: found.userId }, [{ kind: 'sign-ins' }]);
  return found.userId;
}
