/** Read-only evidence for the fixed Athena–Lattice canaries; no credential refresh or mutations. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import postgres from 'postgres';

import {
  acceptanceTargets,
  credentialTiming,
  requestLogMetadata,
} from './lattice-acceptance-report';
import { gcloud, runtime, boundSecret } from './lattice-runtime-inspection';

type EvidenceRow = Record<string, string | boolean | number | Date | null>;
interface CredentialRow {
  connectionId: string;
  ownerUserId: string;
  ciphertext: string;
  updatedAt: Date;
}

async function readDelegations(
  sql: postgres.TransactionSql,
  target: string,
): Promise<EvidenceRow[]> {
  const { assignmentIds, workIds } = acceptanceTargets(target);
  return sql<EvidenceRow[]>`
    select d.id, d.owner_user_id, d.organization_id, d.assignment_id, d.session_id,
      d.task_id, d.connection_id, d.runtime_id, d.logical_submission_id, d.work_id,
      d.status, d.work_state, d.submission_lease_expires_at, d.lattice_account_id,
      d.next_poll_at, d.deadline_at, d.runtime_name, d.runtime_reachability,
      d.runtime_last_seen_at, d.failure_code, d.returned_activity_id,
      d.result_acknowledged_at, d.submitted_at, d.settled_at, d.created_at, d.updated_at,
      (select count(*)::int from agent_delegation sibling
        where sibling.assignment_id = d.assignment_id) as assignment_delegation_count,
      (select count(*)::int from session_activity a
        where a.session_id = d.session_id and a.type = 'action') as action_count,
      (select count(*)::int from session_activity a
        where a.session_id = d.session_id and a.body->'lattice'->>'workId' = d.work_id)
        as returned_work_activity_count,
      a.approval_status as returned_approval_status, a.created_at as returned_activity_created_at,
      a.body->'lattice'->>'delegationId' as returned_delegation_id,
      a.body->'lattice'->>'logicalSubmissionId' as returned_logical_submission_id,
      a.body->'lattice'->>'workId' as returned_work_id,
      a.body->'lattice'->>'runtimeId' as returned_runtime_id,
      a.body->'lattice'->>'outcome' as returned_outcome,
      t.state as task_state, t.assignee_id as task_assignee_id, t.delegate_id as task_delegate_id
    from agent_delegation d
    left join session_activity a on a.id = d.returned_activity_id and a.session_id = d.session_id
    left join task t on t.id = d.task_id and t.organization_id = d.organization_id
    where d.assignment_id = any(${sql.array(assignmentIds)}::text[])
      or d.work_id = any(${sql.array(workIds)}::text[])
    order by d.created_at
  `;
}

async function readConnections(
  sql: postgres.TransactionSql,
  target: string,
): Promise<EvidenceRow[]> {
  const { assignmentIds, workIds } = acceptanceTargets(target);
  return sql<EvidenceRow[]>`
    select distinct c.id, c.owner_user_id, c.status, c.enabled, c.device_id, c.device_name,
      c.device_status, c.granted_scope, c.account_id, c.last_failure_reason,
      c.last_failure_at, c.last_verified_at, c.created_at, c.updated_at
    from lattice_connection c join agent_delegation d
      on d.connection_id = c.id and d.owner_user_id = c.owner_user_id
    where d.assignment_id = any(${sql.array(assignmentIds)}::text[])
      or d.work_id = any(${sql.array(workIds)}::text[])
  `;
}

async function readCredentialTiming(
  sql: postgres.TransactionSql,
  target: string,
): Promise<unknown[]> {
  const { assignmentIds, workIds } = acceptanceTargets(target);
  const rows = await sql<CredentialRow[]>`
    select distinct c.connection_id as "connectionId", c.owner_user_id as "ownerUserId",
      c.ciphertext, c.updated_at as "updatedAt"
    from lattice_credential c join agent_delegation d
      on d.connection_id = c.connection_id and d.owner_user_id = c.owner_user_id
    where d.assignment_id = any(${sql.array(assignmentIds)}::text[])
      or d.work_id = any(${sql.array(workIds)}::text[])
  `;
  const { unsealCredential } = await import('../apps/api/src/lib/credentials');
  return rows.map((row) => ({
    connectionId: row.connectionId,
    ownerUserId: row.ownerUserId,
    updatedAt: row.updatedAt,
    timing: credentialTiming(JSON.parse(unsealCredential(row.ciphertext))),
    claimsVerified: false,
  }));
}

function historicalRequestLogs(): unknown {
  // Request logs only: exclude provider bodies, query strings, and authorization headers.
  const logs: unknown = JSON.parse(
    gcloud([
      'logging',
      'read',
      'resource.type="cloud_run_revision" AND resource.labels.service_name="docket-api" ' +
        'AND logName="projects/athena-services/logs/run.googleapis.com%2Frequests" ' +
        'AND timestamp>="2026-09-30T02:38:10Z" AND timestamp<="2026-09-30T02:38:40Z"',
      '--project=athena-services',
      '--format=json',
      '--limit=100',
    ]),
  );
  return requestLogMetadata(logs);
}

function optionalHistoricalLogs(): unknown {
  try {
    return { status: 'read', records: historicalRequestLogs() };
  } catch {
    // The existing deploy identity may not have logging.viewer; do not widen its authority.
    return { status: 'unavailable', records: [] };
  }
}

async function main(): Promise<void> {
  const [target = '', output = ''] = process.argv.slice(2);
  acceptanceTargets(target);
  if (!output) throw new Error('An output path is required');
  process.stdout.write('Resolving deployed runtime bindings.\n');
  const deployed = runtime(target);
  const databaseUrl = boundSecret(deployed, 'DATABASE_URL');
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = boundSecret(deployed, 'CREDENTIALS_ENCRYPTION_KEY');
  process.env['SKIP_ENV_VALIDATION'] = '1';
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15, idle_timeout: 5 });
  try {
    process.stdout.write('Reading fixed canary records in a read-only transaction.\n');
    const evidence = await sql.begin('isolation level repeatable read read only', async (tx) => ({
      delegations: await readDelegations(tx, target),
      connections: await readConnections(tx, target),
      credentials: await readCredentialTiming(tx, target),
    }));
    const report = {
      generatedAt: new Date().toISOString(),
      target,
      runtime: deployed,
      ...evidence,
      historicalRequestLogs: target === 'production' ? optionalHistoricalLogs() : null,
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write('Scoped read-only Lattice acceptance report saved.\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch(() => {
  // Raw database/provider exceptions may include credentials. Never send them to runner logs.
  process.stderr.write('Lattice acceptance audit failed; no raw provider error was emitted.\n');
  process.exitCode = 1;
});
