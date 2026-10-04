/** Reject only the audited synthetic proposals and rotate only the existing staging mail secret. */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import postgres from 'postgres';
import { boundSecret, gcloud, runtime } from './lattice-runtime-inspection';
import {
  assertStagingBindings,
  assertStagingFixture,
  stagingFixtures,
  providerFailureCode,
} from './lattice-staging-fixtures';
import type { StagingFixtureRow } from './lattice-staging-fixtures';

interface FixtureSnapshot extends StagingFixtureRow {
  taskState: string;
  taskAssigneeId: string | null;
  taskDelegateId: string | null;
  commentCount: number;
  keyCleared: boolean;
  returnCleared: boolean;
  sessionStatus: string;
}

async function snapshots(sql: postgres.Sql): Promise<FixtureSnapshot[]> {
  return sql<FixtureSnapshot[]>`
    select d.id as "delegationId", d.work_id as "workId", d.session_id as "sessionId",
      d.task_id as "taskId", a.id as "activityId", d.owner_user_id as "ownerUserId",
      u.email as "ownerEmail", d.organization_id as "organizationId",
      s.execution_surface as "executionSurface", d.status, a.approval_status as "approvalStatus",
      a.type, t.state as "taskState", t.assignee_id as "taskAssigneeId",
      t.delegate_id as "taskDelegateId", s.status as "sessionStatus",
      d.reply_key_ciphertext is null as "keyCleared", d.returned_activity_id is null as "returnCleared",
      (select count(*)::int from comment c where c.subject_type = 'task'
        and c.subject_id = t.id and c.organization_id = d.organization_id) as "commentCount"
    from agent_delegation d
    join agent_session s on s.id = d.session_id and s.owner_user_id = d.owner_user_id
      and s.context_organization_id = d.organization_id
    join session_activity a on a.session_id = s.id
      and a.id = any(${sql.array(stagingFixtures.map((f) => f.activityId))}::text[])
    join task t on t.id = d.task_id and t.organization_id = d.organization_id
    join "user" u on u.id = d.owner_user_id
    where d.work_id = any(${sql.array(stagingFixtures.map((f) => f.workId))}::text[])
    order by d.created_at
  `;
}

function assertSettled(before: FixtureSnapshot, after: FixtureSnapshot): void {
  assertStagingFixture(after);
  if (
    after.status !== 'canceled' ||
    after.approvalStatus !== 'rejected' ||
    !after.keyCleared ||
    !after.returnCleared ||
    after.sessionStatus !== 'canceled' ||
    before.commentCount !== after.commentCount ||
    before.taskState !== after.taskState ||
    before.taskAssigneeId !== after.taskAssigneeId ||
    before.taskDelegateId !== after.taskDelegateId
  ) {
    throw new Error('Staging rejection postcondition failed');
  }
}

async function rejectFixtures(databaseUrl: string): Promise<FixtureSnapshot[]> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  const { closeDb } = await import('../packages/db/src/index');
  try {
    const before = await snapshots(sql);
    if (before.length !== stagingFixtures.length) throw new Error('Missing staging fixtures');
    before.forEach(assertStagingFixture);
    const { decideActivity } = await import('../apps/api/src/routes/agent-session-approval');
    for (const row of before) {
      if (row.approvalStatus === 'proposed') {
        await decideActivity(row.organizationId, null, row.sessionId, row.activityId, {
          decision: 'reject',
        });
      }
    }
    const after = await snapshots(sql);
    for (const original of before) {
      const settled = after.find((row) => row.workId === original.workId);
      if (!settled) throw new Error('Staging fixture disappeared');
      assertSettled(original, settled);
    }
    return after;
  } finally {
    await sql.end({ timeout: 5 });
    await closeDb();
  }
}

interface MailProgress {
  phase: string;
  secretVersion: string | null;
}

function rotateStagingMail(progress: MailProgress): {
  secretVersion: string;
  revision: string | null;
} {
  const key = process.env['STAGING_MAIL_REPLACEMENT']?.trim();
  if (!key || !/^re_[A-Za-z0-9_]+$/.test(key)) throw new Error('Missing staging mail replacement');
  progress.phase = 'secret_version_add';
  const name = execFileSync(
    'gcloud',
    [
      'secrets',
      'versions',
      'add',
      'docket-staging-resend-api-key',
      '--data-file=-',
      '--project=athena-services',
      '--format=value(name)',
      '--quiet',
    ],
    { input: key, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
  ).trim();
  const version = /\/versions\/(\d+)$/.exec(name)?.[1];
  if (!version) throw new Error('Unexpected secret version response');
  progress.secretVersion = version;
  progress.phase = 'staging_service_update';
  gcloud([
    'run',
    'services',
    'update',
    'docket-api-staging',
    '--project=athena-services',
    '--region=us-central1',
    `--update-secrets=RESEND_API_KEY=docket-staging-resend-api-key:${version}`,
    '--quiet',
  ]);
  progress.phase = 'staging_binding_verify';
  const deployed = runtime('staging');
  if (deployed.bindings.find((b) => b.environmentName === 'RESEND_API_KEY')?.version !== version) {
    throw new Error('Staging mail binding did not change');
  }
  return { secretVersion: version, revision: deployed.revision };
}

async function saveReport(output: string, report: unknown): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output || process.env['APP_MODE'] !== 'staging')
    throw new Error('Staging mode/output required');
  const stage = runtime('staging');
  assertStagingBindings(stage.bindings);
  const productionBefore = runtime('production');
  const databaseUrl = boundSecret(stage, 'DATABASE_URL');
  process.env['DATABASE_URL'] = databaseUrl;
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = boundSecret(stage, 'CREDENTIALS_ENCRYPTION_KEY');
  process.env['SKIP_ENV_VALIDATION'] = '1';
  const fixtures = await rejectFixtures(databaseUrl);
  // Preserve committed decisions before independent provider operations can fail.
  await saveReport(output, {
    generatedAt: new Date().toISOString(),
    fixtures,
    mail: { status: 'not_started' },
    productionVerification: 'pending',
  });
  let mail: unknown;
  let mailFailed = false;
  const progress: MailProgress = { phase: 'replacement_validation', secretVersion: null };
  try {
    mail = { status: 'rotated', ...rotateStagingMail(progress) };
  } catch (error: unknown) {
    mail = { status: 'provider_operation_failed', ...progress, code: providerFailureCode(error) };
    mailFailed = true;
  }
  await saveReport(output, {
    generatedAt: new Date().toISOString(),
    fixtures,
    mail,
    productionVerification: 'pending',
  });
  let productionStable: boolean | null = null;
  try {
    productionStable = JSON.stringify(productionBefore) === JSON.stringify(runtime('production'));
  } catch {
    // Retain the committed decisions and acquired secret version if inspection is unavailable.
  }
  await saveReport(output, {
    generatedAt: new Date().toISOString(),
    fixtures,
    mail,
    productionStable,
    productionVerification: productionStable === null ? 'unavailable' : 'verified',
  });
  if (mailFailed || productionStable !== true) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('Staging hygiene failed; no raw database/provider error was emitted.\n');
  process.exitCode = 1;
});
