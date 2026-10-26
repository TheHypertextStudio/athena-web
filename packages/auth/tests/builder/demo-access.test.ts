import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  actor,
  db,
  demo,
  demoWorkspace,
  organization,
  demoBudget,
  serviceControl,
  user,
} from '@docket/db';
import { resolveDemoSignIn } from '../../src/demo-access';

const credential = { slug: 'review', email: 'reviewer@example.com', token: 'a'.repeat(43) };
const digest = createHash('sha256')
  .update(`${credential.slug}\n${credential.email}\n${credential.token}`)
  .digest('hex');

beforeAll(async () => {
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../../db/drizzle'),
  });
  await db
    .insert(organization)
    .values({ id: 'demo-org', name: 'Reviewer workspace', slug: 'reviewer-workspace' });
  await db.insert(demo).values({
    id: 'demo-rules',
    name: 'Review',
    slug: 'review',
    sourceOrganizationId: 'demo-org',
    mode: 'shared',
    signInTokenHash: digest,
    allowedEmails: ['reviewer@example.com'],
  });
  await db
    .insert(user)
    .values({ id: 'reviewer', email: credential.email, emailVerified: true, name: 'Reviewer' });
  await db.insert(actor).values({
    id: 'reviewer-actor',
    organizationId: 'demo-org',
    kind: 'human',
    displayName: 'Reviewer',
    userId: 'reviewer',
  });
  await db.insert(demoWorkspace).values({ demoId: 'demo-rules', organizationId: 'demo-org' });
});
beforeEach(async () => {
  await db.delete(demoBudget);
  await db
    .update(demo)
    .set({
      status: 'active',
      expiresAt: null,
      allowedEmails: [credential.email],
      signInTokenHash: digest,
    })
    .where(eq(demo.id, 'demo-rules'));
  await db.update(actor).set({ status: 'active' }).where(eq(actor.id, 'reviewer-actor'));
  await db.update(demoWorkspace).set({ expiresAt: null });
  await db.delete(serviceControl).where(eq(serviceControl.key, 'demo_sign_in'));
});

describe('live demo access rules', () => {
  it('limits valid link exchanges across new sessions for the same reviewer', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(resolveDemoSignIn(credential)).resolves.toBe('reviewer');
    }
    await expect(resolveDemoSignIn(credential)).rejects.toMatchObject({
      name: 'DemoBudgetExceeded',
    });
  });
  it('matches the exact address case-insensitively and rejects other addresses', async () => {
    await expect(
      resolveDemoSignIn({ ...credential, email: ' REVIEWER@EXAMPLE.COM ' }),
    ).resolves.toBe('reviewer');
    await expect(
      resolveDemoSignIn({ ...credential, email: 'other@example.com' }),
    ).resolves.toBeNull();
  });
  it('binds the secret to the exact email and demo and requires active membership', async () => {
    await expect(resolveDemoSignIn({ ...credential, token: 'b'.repeat(43) })).resolves.toBeNull();
    await expect(resolveDemoSignIn({ ...credential, slug: 'other' })).resolves.toBeNull();
    await db.update(actor).set({ status: 'suspended' }).where(eq(actor.id, 'reviewer-actor'));
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
  });
  it('rejects revoked credentials, removed allow-list entries and expired workspaces', async () => {
    await db.update(demo).set({ signInTokenHash: null });
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
    await db.update(demo).set({ signInTokenHash: digest, allowedEmails: [] });
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
    await db.update(demo).set({ allowedEmails: [credential.email] });
    await db.update(demoWorkspace).set({ expiresAt: new Date(0) });
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
  });
  it('refuses disabled and expired demos', async () => {
    await db.update(demo).set({ status: 'disabled' }).where(eq(demo.id, 'demo-rules'));
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
    await db
      .update(demo)
      .set({ status: 'active', expiresAt: new Date(0) })
      .where(eq(demo.id, 'demo-rules'));
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
  });
  it('reads the kill switch on every decision', async () => {
    await db.insert(serviceControl).values({ key: 'demo_sign_in', enabled: false });
    await expect(resolveDemoSignIn(credential)).resolves.toBeNull();
    await db
      .update(serviceControl)
      .set({ enabled: true })
      .where(and(eq(serviceControl.key, 'demo_sign_in')));
    await expect(resolveDemoSignIn(credential)).resolves.toBe('reviewer');
  });
});
