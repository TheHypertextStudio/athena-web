/**
 * Creates a shared demo workspace that a named person can sign into with an operator-supplied magic link.
 *
 * @remarks
 * Usage: `pnpm exec tsx scripts/seed-demo.ts <slug> "<demo name>" <email> "<workspace name>" <private-link-file>`.
 *
 * The script creates the person's account (without a passkey), an organization owned by them,
 * a few sample tasks in its default team, and an active demo whose allow list is that email.
 * It refuses to run when the slug already exists, so re-running never duplicates a workspace.
 */
import { createHash, randomBytes } from 'node:crypto';
import { openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  db,
  closeDb,
  demo,
  demoWorkspace,
  genId,
  hub,
  user,
  task,
  workStatus,
  organizationBillingAccount,
  organizationProductEntitlement,
  billingExemption,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { createOrganizationInTransaction } from '../src/services/organization-create';

const SAMPLE_TASKS: readonly {
  readonly title: string;
  readonly category: 'unstarted' | 'started';
}[] = [
  { title: 'Review the onboarding checklist', category: 'unstarted' },
  { title: 'Plan the next launch milestone', category: 'started' },
  { title: 'Invite a teammate to a project', category: 'unstarted' },
  { title: 'Set a due date on a task', category: 'started' },
];

/** Parsed command-line arguments. */
interface SeedArgs {
  readonly slug: string;
  readonly demoName: string;
  readonly email: string;
  readonly workspaceName: string;
  readonly linkFile: string;
}

/**
 * Reads and validates the seed arguments and private output path.
 *
 * @returns The parsed arguments.
 * @throws {Error} When an argument is missing or the email is malformed.
 */
function parseArgs(argv: readonly string[]): SeedArgs {
  const [slug, demoName, email, workspaceName, linkFile] = argv;
  if (!slug || !demoName || !email || !workspaceName || !linkFile || !isAbsolute(linkFile)) {
    throw new Error(
      'Usage: seed-demo.ts <slug> "<demo name>" <email> "<workspace name>" <absolute-private-link-file>',
    );
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error(`Not an email address: ${email}`);
  return { slug, demoName, email: normalized, workspaceName, linkFile };
}

/**
 * Seeds the demo, its owner, its workspace, and its sample tasks in one transaction.
 *
 * @param args - The parsed command-line arguments.
 * @returns The new demo's id and its organization id.
 * @throws {Error} When the slug already exists.
 */
async function seedDemo(
  args: SeedArgs,
  token: string,
): Promise<{ demoId: string; organizationId: string }> {
  const [existing] = await db
    .select({ id: demo.id })
    .from(demo)
    .where(eq(demo.slug, args.slug))
    .limit(1);
  if (existing) throw new Error(`A demo with slug "${args.slug}" already exists.`);

  return db.transaction(async (tx) => {
    const userId = genId();
    await tx.insert(user).values({
      id: userId,
      email: args.email,
      emailVerified: true,
      name: args.email.split('@')[0] ?? args.email,
    });
    await tx.insert(hub).values({ userId });

    const seeded = await createOrganizationInTransaction(tx, {
      name: args.workspaceName,
      slug: args.slug,
      purpose: undefined,
      isPersonal: false,
      vocabulary: { preset: 'startup' },
      ownerDisplayName: args.email,
      ownerUserId: userId,
    });

    const statuses = await tx
      .select({ id: workStatus.id, key: workStatus.key, category: workStatus.category })
      .from(workStatus)
      .where(and(eq(workStatus.organizationId, seeded.org.id), eq(workStatus.entityType, 'task')));

    for (const sample of SAMPLE_TASKS) {
      const status = statuses.find((s) => s.category === sample.category);
      if (!status) throw new Error(`No ${sample.category} task status in the new workspace.`);
      await tx.insert(task).values({
        organizationId: seeded.org.id,
        teamId: seeded.defaultTeam.id,
        title: sample.title,
        state: status.key,
        statusId: status.id,
        createdBy: seeded.ownerActor.id,
        assigneeId: seeded.ownerActor.id,
      });
    }

    // A reviewer can exercise shared work without starting a trial or entering payment details.
    await tx.insert(billingExemption).values({ organizationId: seeded.org.id, reason: 'demo' });
    await tx
      .insert(organizationBillingAccount)
      .values({ organizationId: seeded.org.id, trialConsumedAt: new Date() });
    await tx.insert(organizationProductEntitlement).values({
      organizationId: seeded.org.id,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });

    const [demoRow] = await tx
      .insert(demo)
      .values({
        slug: args.slug,
        name: args.demoName,
        sourceOrganizationId: seeded.org.id,
        mode: 'shared',
        signInTokenHash: createHash('sha256')
          .update(`${args.slug}\n${args.email}\n${token}`)
          .digest('hex'),
        allowedEmails: [args.email],
        status: 'active',
      })
      .returning({ id: demo.id });
    if (!demoRow) throw new Error('demo insert returned no row');

    await tx.insert(demoWorkspace).values({
      demoId: demoRow.id,
      organizationId: seeded.org.id,
      ownerUserId: null,
    });

    return { demoId: demoRow.id, organizationId: seeded.org.id };
  });
}

try {
  if (process.env['APP_MODE'] !== 'local' || !process.env['DATABASE_URL']?.startsWith('pglite:')) {
    throw new Error('This seed command requires APP_MODE=local and a local PGlite database.');
  }
  const args = parseArgs(process.argv.slice(2));
  const origin = new URL(process.env['APP_URL'] ?? 'http://localhost');
  if (origin.hostname !== 'localhost' && !origin.hostname.endsWith('.localhost')) {
    throw new Error('APP_URL must identify the local dev stack.');
  }
  const output = openSync(args.linkFile, 'wx', 0o600);
  try {
    const token = randomBytes(32).toString('base64url');
    const result = await seedDemo(args, token);
    const link = new URL('/sign-in', origin);
    link.searchParams.set('demo', args.slug);
    link.hash = new URLSearchParams({ email: args.email, token }).toString();
    writeFileSync(output, `${link.href}\n`);
    console.log(
      `Seeded demo ${result.demoId} with workspace ${result.organizationId}. Private link saved to ${args.linkFile}.`,
    );
  } catch (error) {
    unlinkSync(args.linkFile);
    throw error;
  } finally {
    closeSync(output);
  }
} finally {
  await closeDb();
}
