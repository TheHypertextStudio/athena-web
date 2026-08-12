import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { genId } from '../../src/id';
import { fullSchema, type Database } from '../../src/client';
import {
  account,
  accountExport,
  actor,
  actorKind,
  agent,
  agentElicitation,
  agentExecution,
  agentSession,
  agentSessionDispatch,
  agentSessionExternalLink,
  agentSessionRun,
  agentSessionTranscript,
  athenaAssignment,
  athenaConversationSegment,
  athenaInboundMessage,
  athenaMailbox,
  athenaPresence,
  athenaTrigger,
  attachment,
  auditEvent,
  auditEventType,
  automationRule,
  billingExemption,
  calendarConnection,
  calendarEvent,
  calendarItem,
  calendarItemRelation,
  calendarItemTaskLink,
  calendarItemWrite,
  calendarLayer,
  calendarLayerShare,
  calendarList,
  changeSet,
  changeSetEntry,
  comment,
  contactPoint,
  cycle,
  dailyDigest,
  dailyPlanItem,
  dayCheckIn,
  dayDirective,
  dayReview,
  directiveAcknowledgment,
  emailSuggestion,
  entityDisplay,
  event,
  eventRecipient,
  eventSubscription,
  executionRequestNonce,
  externalActor,
  grant,
  hub,
  idempotencyKey,
  impersonationSession,
  inboundEvent,
  initiative,
  initiativeHierarchyLink,
  initiativeLabel,
  initiativeProgram,
  initiativeProject,
  integration,
  integrationCredential,
  invitation,
  jwks,
  label,
  latticeConnection,
  latticeCredential,
  lifecycleHold,
  mcpSession,
  mcpSubscription,
  milestone,
  notification,
  notificationDelivery,
  notificationInboundEvent,
  notificationIntent,
  notificationPreference,
  notificationRecipient,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  operatorAuditEvent,
  organization,
  passkey,
  personalMcpConnection,
  personalMcpCredential,
  phoneNumber,
  phoneVerification,
  program,
  project,
  projectDependency,
  projectLabel,
  publication,
  rateLimit,
  resourceKind,
  role,
  savedView,
  scheduleRun,
  schedulingPreference,
  searchDocument,
  searchIndexJob,
  session,
  sessionActivity,
  staffUser,
  streamSubscription,
  syncRun,
  task,
  taskDependency,
  taskLabel,
  team,
  teamMember,
  threadParticipation,
  timeAllocation,
  timeCategory,
  timeContext,
  timeInterval,
  timeRecord,
  timeShareToken,
  timeSubmission,
  timeSubmissionItem,
  twoFactor,
  update,
  user,
  verification,
  voiceSession,
  workspaceDomain,
} from '../../src/schema';
import {
  defaultWorkflowStates,
  presetStartup,
  type AgentConnection,
  type ApprovalRouting,
  type GrantCapabilityList,
  type HubLanding,
  type HubPreferences,
  type IntegrationConnection,
  type NotificationBody,
  type SessionActivityBody,
  type VocabularySkin,
  type WorkflowState,
  type WorkflowStateType,
} from '../../src/types';
import {
  actorRelations,
  calendarItemRelationRelations,
  calendarItemRelations,
  calendarLayerRelations,
  calendarLayerShareRelations,
  organizationRelations,
} from '../../src/relations';

describe('genId', () => {
  it('returns a 26-char Crockford ULID', () => {
    expect(genId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns sortable, unique ids', () => {
    const a = genId();
    const b = genId();
    expect(a).not.toEqual(b);
  });
});

describe('types + enums + relations', () => {
  it('exposes the default workflow states with the backlog default first', () => {
    expect(defaultWorkflowStates[0]?.key).toBe('backlog');
    expect(defaultWorkflowStates).toHaveLength(5);
    const types = defaultWorkflowStates.map((s) => s.type);
    expect(types).toEqual(['backlog', 'unstarted', 'started', 'completed', 'canceled']);
  });

  it('exposes the startup vocabulary preset default', () => {
    expect(presetStartup).toEqual({ preset: 'startup' });
  });

  it('enumerates pg enum values', () => {
    expect(actorKind.enumValues).toContain('agent');
    expect(resourceKind.enumValues).toContain('organization');
    expect(auditEventType.enumValues).toContain('created');
  });

  it('wires the relation builders', () => {
    expect(organizationRelations).toBeDefined();
    expect(actorRelations).toBeDefined();
    expect(calendarLayerRelations).toBeDefined();
    expect(calendarItemRelations).toBeDefined();
    expect(calendarItemRelationRelations).toBeDefined();
    expect(calendarLayerShareRelations).toBeDefined();
  });

  it('defines calendar item relations and per-workspace layer sharing structurally', () => {
    const relationConfig = getTableConfig(calendarItemRelation);
    expect(relationConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['source_item_id', 'target_item_id', 'role', 'created_by_user_id']),
    );
    expect(relationConfig.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'source_item_id',
      'target_item_id',
    ]);

    const shareConfig = getTableConfig(calendarLayerShare);
    expect(shareConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['layer_id', 'organization_id', 'access', 'created_by']),
    );
    expect(shareConfig.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'layer_id',
      'organization_id',
    ]);
  });

  it('lets the jsonb $type shapes be constructed', () => {
    const state: WorkflowState = { key: 'k', name: 'K', type: 'started', position: 0 };
    const stType: WorkflowStateType = 'completed';
    const skin: VocabularySkin = {
      preset: 'agency',
      overrides: { task: { singular: 'Ticket', plural: 'Tickets' } },
    };
    const landing: HubLanding = { orgId: 'org_1' };
    const prefs: HubPreferences = {
      landing,
      density: 'compact',
      theme: 'dark',
      timezone: 'UTC',
      calendar: {
        pixelsPerHour: 72.5,
        minLaneWidth: 240.5,
        defaultCreateIntent: 'event',
        defaultLayerId: null,
      },
      athena: {
        instructions: 'Protect focus time.',
        approvalMode: 'ask_before_acting',
      },
    };
    const conn: AgentConnection = { endpoint: 'https://x', protocol: 'mcp', credentialsRef: 'c' };
    const routing: ApprovalRouting = { mode: 'role', approverRoleId: 'r' };
    const integrationConn: IntegrationConnection = {
      account: 'a',
      credentialsRef: 'c',
      externalWorkspaceId: 'w',
    };
    const notif: NotificationBody = { title: 'Hi', summary: 's', url: 'u', extra: 1 };
    const activity: SessionActivityBody = {
      text: 't',
      action: { kind: 'update_task', summary: 's', diff: {} },
    };
    const caps: GrantCapabilityList = ['view', 'manage'];
    expect([
      state,
      stType,
      skin,
      prefs,
      conn,
      routing,
      integrationConn,
      notif,
      activity,
      caps,
    ]).toHaveLength(10);
  });
});

describe('schema foreign-key references (covers every `.references(() => …)` callback)', () => {
  // Every declared table across every schema island. `getTableConfig(t).foreignKeys[i].reference()`
  // invokes each table's lazy `() => other.col` FK callback — these are not run on import, only
  // when something (drizzle-kit codegen, or this loop) actually asks a table for its FK config. A
  // schema island that adds a table without adding it here loses this net for its own FKs, so this
  // map is meant to be the complete table list, not a curated sample.
  const allTables: Record<string, PgTable> = {
    user,
    session,
    account,
    verification,
    passkey,
    twoFactor,
    oauthClient,
    oauthAccessToken,
    oauthRefreshToken,
    oauthConsent,
    jwks,
    rateLimit,
    hub,
    accountExport,
    organization,
    actor,
    team,
    teamMember,
    invitation,
    role,
    grant,
    entityDisplay,
    update,
    dailyPlanItem,
    notificationIntent,
    notificationRecipient,
    notificationDelivery,
    notificationPreference,
    contactPoint,
    notificationInboundEvent,
    notification,
    integration,
    integrationCredential,
    syncRun,
    externalActor,
    attachment,
    emailSuggestion,
    automationRule,
    calendarConnection,
    calendarList,
    calendarEvent,
    calendarLayer,
    calendarItem,
    calendarItemTaskLink,
    calendarItemRelation,
    calendarLayerShare,
    calendarItemWrite,
    label,
    comment,
    auditEvent,
    savedView,
    initiative,
    program,
    project,
    milestone,
    cycle,
    task,
    initiativeProject,
    initiativeProgram,
    initiativeHierarchyLink,
    initiativeLabel,
    projectLabel,
    taskLabel,
    taskDependency,
    projectDependency,
    agent,
    agentSession,
    agentSessionRun,
    agentSessionDispatch,
    executionRequestNonce,
    sessionActivity,
    athenaConversationSegment,
    agentSessionTranscript,
    agentSessionExternalLink,
    personalMcpConnection,
    personalMcpCredential,
    athenaAssignment,
    athenaTrigger,
    latticeConnection,
    latticeCredential,
    agentElicitation,
    athenaPresence,
    staffUser,
    impersonationSession,
    lifecycleHold,
    operatorAuditEvent,
    billingExemption,
    idempotencyKey,
    inboundEvent,
    event,
    eventRecipient,
    streamSubscription,
    dailyDigest,
    threadParticipation,
    eventSubscription,
    searchDocument,
    searchIndexJob,
    mcpSession,
    mcpSubscription,
    changeSet,
    changeSetEntry,
    publication,
    workspaceDomain,
    phoneNumber,
    phoneVerification,
    voiceSession,
    schedulingPreference,
    scheduleRun,
    dayDirective,
    dayCheckIn,
    dayReview,
    directiveAcknowledgment,
    athenaMailbox,
    athenaInboundMessage,
    timeCategory,
    timeRecord,
    timeInterval,
    timeShareToken,
    timeContext,
    timeAllocation,
    agentExecution,
    timeSubmission,
    timeSubmissionItem,
  };

  it('resolves the lazy FK reference of every table', () => {
    let resolved = 0;
    for (const [name, t] of Object.entries(allTables)) {
      const cfg = getTableConfig(t);
      for (const fk of cfg.foreignKeys) {
        const ref = fk.reference();
        expect(ref.foreignTable, `${name} FK foreignTable`).toBeDefined();
        resolved += 1;
      }
    }
    expect(resolved).toBeGreaterThan(0);
  });

  it('models the Time Ledger category hierarchy in Drizzle metadata', () => {
    const parentForeignKeys = getTableConfig(timeCategory).foreignKeys.filter(
      (foreignKey) => foreignKey.getName() === 'time_category_parent_id_time_category_id_fk',
    );

    expect(parentForeignKeys).toHaveLength(1);
    const parentForeignKey = parentForeignKeys[0];
    expect(parentForeignKey).toBeDefined();
    expect(parentForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      timeCategory.parentId.name,
    ]);
    expect(parentForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual([
      timeCategory.id.name,
    ]);
    expect(parentForeignKey?.onDelete).toBe('set null');
  });
});

describe('schema inserts + updates (covers $defaultFn + $onUpdate callbacks)', () => {
  let db!: Database;
  let client: PGlite | undefined;
  // Shared ids threaded through the FK graph.
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    client = new PGlite('memory://');
    const d = drizzle(client, { schema: fullSchema });
    await migrate(d, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
    db = d;

    // --- auth island (user/session/account/verification/passkey) ---
    ids['user'] = (
      await db.insert(user).values({ name: 'Ada', email: 'ada@example.com' }).returning()
    )[0]!.id;
    ids['session'] = (
      await db
        .insert(session)
        .values({ token: 'tok-1', userId: ids['user'], expiresAt: new Date(Date.now() + 3.6e6) })
        .returning()
    )[0]!.id;
    ids['account'] = (
      await db
        .insert(account)
        .values({ accountId: 'acc-1', providerId: 'credential', userId: ids['user'] })
        .returning()
    )[0]!.id;
    ids['verification'] = (
      await db
        .insert(verification)
        .values({
          identifier: 'ada@example.com',
          value: 'v',
          expiresAt: new Date(Date.now() + 3.6e6),
        })
        .returning()
    )[0]!.id;
    ids['passkey'] = (
      await db
        .insert(passkey)
        .values({
          publicKey: 'pk',
          userId: ids['user'],
          credentialID: 'cred-1',
          counter: 0,
          deviceType: 'singleDevice',
          backedUp: false,
        })
        .returning()
    )[0]!.id;
    // oauthProvider island: client → refresh-token → access-token, + consent (FK on clientId;
    // access-token's refreshId FKs the refresh-token row).
    const oauthClientId = 'docket-mcp-client';
    ids['oauthClient'] = (
      await db
        .insert(oauthClient)
        .values({
          name: 'Docket MCP',
          clientId: oauthClientId,
          clientSecret: 'sec',
          redirectUris: ['https://docket.example/callback'],
          type: 'web',
          userId: ids['user'],
        })
        .returning()
    )[0]!.id;
    ids['oauthRefreshToken'] = (
      await db
        .insert(oauthRefreshToken)
        .values({
          token: 'rt-1',
          clientId: oauthClientId,
          userId: ids['user'],
          expiresAt: new Date(Date.now() + 8.64e7),
          scopes: ['openid', 'profile'],
        })
        .returning()
    )[0]!.id;
    ids['oauthAccessToken'] = (
      await db
        .insert(oauthAccessToken)
        .values({
          token: 'at-1',
          clientId: oauthClientId,
          userId: ids['user'],
          refreshId: ids['oauthRefreshToken'],
          expiresAt: new Date(Date.now() + 3.6e6),
          scopes: ['openid', 'profile'],
        })
        .returning()
    )[0]!.id;
    ids['oauthConsent'] = (
      await db
        .insert(oauthConsent)
        .values({
          clientId: oauthClientId,
          userId: ids['user'],
          scopes: ['openid', 'profile'],
        })
        .returning()
    )[0]!.id;
    ids['jwks'] = (
      await db
        .insert(jwks)
        .values({ publicKey: 'pub-1', privateKey: 'priv-1', createdAt: new Date() })
        .returning()
    )[0]!.id;

    // --- identity island ---
    ids['hub'] = (await db.insert(hub).values({ userId: ids['user'] }).returning())[0]!.id;
    ids['org'] = (
      await db.insert(organization).values({ name: 'Acme', slug: 'acme' }).returning()
    )[0]!.id;
    ids['role'] = (
      await db
        .insert(role)
        .values({
          organizationId: ids['org'],
          key: 'owner',
          name: 'Owner',
          isSystem: true,
          baseCapability: 'manage',
          capabilities: ['manage'],
        })
        .returning()
    )[0]!.id;
    ids['actor'] = (
      await db
        .insert(actor)
        .values({
          organizationId: ids['org'],
          kind: 'human',
          displayName: 'Ada',
          userId: ids['user'],
          roleId: ids['role'],
        })
        .returning()
    )[0]!.id;
    ids['team'] = (
      await db
        .insert(team)
        .values({ organizationId: ids['org'], name: 'Core', key: 'CORE' })
        .returning()
    )[0]!.id;
    await db
      .insert(teamMember)
      .values({ teamId: ids['team'], actorId: ids['actor'], organizationId: ids['org'] });
    ids['invitation'] = (
      await db
        .insert(invitation)
        .values({
          organizationId: ids['org'],
          email: 'new@example.com',
          roleId: ids['role'],
          token: 'inv-tok',
          expiresAt: new Date(Date.now() + 3.6e6),
        })
        .returning()
    )[0]!.id;

    // --- crosscutting island ---
    ids['grant'] = (
      await db
        .insert(grant)
        .values({
          organizationId: ids['org'],
          subjectKind: 'role',
          subjectId: ids['role'],
          resourceKind: 'organization',
          resourceId: ids['org'],
          capabilities: ['manage'],
        })
        .returning()
    )[0]!.id;
    ids['integration'] = (
      await db
        .insert(integration)
        .values({ organizationId: ids['org'], provider: 'linear', pattern: 'connector' })
        .returning()
    )[0]!.id;
    ids['label'] = (
      await db
        .insert(label)
        .values({ organizationId: ids['org'], name: 'bug', color: '#f00' })
        .returning()
    )[0]!.id;
    ids['notification'] = (
      await db
        .insert(notification)
        .values({ userId: ids['user'], type: 'mention', body: { title: 'You were mentioned' } })
        .returning()
    )[0]!.id;
    ids['dailyPlanItem'] = (
      await db
        .insert(dailyPlanItem)
        .values({
          hubId: ids['hub'],
          refOrganizationId: ids['org'],
          refTaskId: 'task-ref',
          date: '2026-06-05',
        })
        .returning()
    )[0]!.id;
    ids['savedView'] = (
      await db.insert(savedView).values({ organizationId: ids['org'], name: 'My View' }).returning()
    )[0]!.id;

    // --- work island ---
    ids['initiative'] = (
      await db.insert(initiative).values({ organizationId: ids['org'], name: 'Vision' }).returning()
    )[0]!.id;
    ids['program'] = (
      await db.insert(program).values({ organizationId: ids['org'], name: 'Ops' }).returning()
    )[0]!.id;
    ids['project'] = (
      await db
        .insert(project)
        .values({
          organizationId: ids['org'],
          name: 'Launch',
          programId: ids['program'],
          teamId: ids['team'],
          leadId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['milestone'] = (
      await db
        .insert(milestone)
        .values({ organizationId: ids['org'], projectId: ids['project'], name: 'Alpha' })
        .returning()
    )[0]!.id;
    ids['cycle'] = (
      await db
        .insert(cycle)
        .values({
          organizationId: ids['org'],
          teamId: ids['team'],
          number: 1,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 8.64e7),
        })
        .returning()
    )[0]!.id;
    ids['task'] = (
      await db
        .insert(task)
        .values({
          organizationId: ids['org'],
          title: 'Do the thing',
          teamId: ids['team'],
          state: 'backlog',
          projectId: ids['project'],
          milestoneId: ids['milestone'],
          cycleId: ids['cycle'],
          assigneeId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['task2'] = (
      await db
        .insert(task)
        .values({
          organizationId: ids['org'],
          title: 'Second',
          teamId: ids['team'],
          state: 'backlog',
        })
        .returning()
    )[0]!.id;

    // entities that reference work + crosscutting subjects
    ids['update'] = (
      await db
        .insert(update)
        .values({
          organizationId: ids['org'],
          subjectType: 'project',
          subjectId: ids['project'],
          body: 'Going well',
          health: 'on_track',
          authorId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['comment'] = (
      await db
        .insert(comment)
        .values({
          organizationId: ids['org'],
          subjectType: 'task',
          subjectId: ids['task'],
          body: 'Nice',
          authorId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['auditEvent'] = (
      await db
        .insert(auditEvent)
        .values({
          organizationId: ids['org'],
          subjectType: 'task',
          subjectId: ids['task'],
          type: 'created',
          actorId: ids['actor'],
        })
        .returning()
    )[0]!.id;

    // --- joins island ---
    await db.insert(initiativeProject).values({
      initiativeId: ids['initiative'],
      projectId: ids['project'],
      organizationId: ids['org'],
    });
    await db.insert(initiativeProgram).values({
      initiativeId: ids['initiative'],
      programId: ids['program'],
      organizationId: ids['org'],
    });
    await db
      .insert(taskLabel)
      .values({ taskId: ids['task'], labelId: ids['label'], organizationId: ids['org'] });
    await db.insert(taskDependency).values({
      blockingTaskId: ids['task'],
      blockedTaskId: ids['task2'],
      organizationId: ids['org'],
    });

    // --- agents island ---
    ids['agentActor'] = (
      await db
        .insert(actor)
        .values({ organizationId: ids['org'], kind: 'agent', displayName: 'Bot' })
        .returning()
    )[0]!.id;
    ids['agent'] = (
      await db
        .insert(agent)
        .values({
          organizationId: ids['org'],
          actorId: ids['agentActor'],
          connection: { endpoint: 'https://bot', protocol: 'mcp' },
          accountableOwnerId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['agentSession'] = (
      await db
        .insert(agentSession)
        .values({
          organizationId: ids['org'],
          agentId: ids['agent'],
          taskId: ids['task'],
          trigger: 'assignment',
          initiatorId: ids['actor'],
        })
        .returning()
    )[0]!.id;
    ids['sessionActivity'] = (
      await db
        .insert(sessionActivity)
        .values({
          sessionId: ids['agentSession'],
          organizationId: ids['org'],
          type: 'thought',
          body: { text: 'thinking' },
          approvalStatus: 'proposed',
        })
        .returning()
    )[0]!.id;

    // --- admin island ---
    ids['staffUser'] = (
      await db.insert(staffUser).values({ userId: ids['user'], role: 'superadmin' }).returning()
    )[0]!.id;
    ids['impersonation'] = (
      await db
        .insert(impersonationSession)
        .values({
          staffUserId: ids['staffUser'],
          targetUserId: ids['user'],
          reason: 'support',
          expiresAt: new Date(Date.now() + 3.6e6),
        })
        .returning()
    )[0]!.id;
    ids['lifecycleHold'] = (
      await db
        .insert(lifecycleHold)
        .values({ organizationId: ids['org'], reason: 'dispute', placedBy: ids['staffUser'] })
        .returning()
    )[0]!.id;
    ids['operatorAudit'] = (
      await db
        .insert(operatorAuditEvent)
        .values({
          staffUserId: ids['staffUser'],
          type: 'hold_placed',
          subjectType: 'organization',
          subjectId: ids['org'],
        })
        .returning()
    )[0]!.id;

    // --- infra island ---
    await db.insert(idempotencyKey).values({
      userId: ids['user'],
      key: 'idem-1',
      organizationId: ids['org'],
      method: 'POST',
      path: '/v1/tasks',
      requestHash: 'h',
      expiresAt: new Date(Date.now() + 8.64e7),
    });
  });

  afterAll(async () => {
    await client?.close();
  });

  it('applies migrations and creates the core tables', async () => {
    const coreTables = [
      'organization',
      'actor',
      'team',
      'task',
      'role',
      'grant',
      'user',
      'passkey',
    ];
    for (const table of coreTables) {
      const res = await client!.query<{ reg: string | null }>('select to_regclass($1) as reg', [
        `public.${table}`,
      ]);
      expect(res.rows[0]?.reg, `table ${table} should exist`).not.toBeNull();
    }
  });

  it('generated a ULID id for every inserted row', () => {
    for (const [name, id] of Object.entries(ids)) {
      expect(id, `${name} id`).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('updates the rows whose updatedAt has an $onUpdate callback', async () => {
    // Distinct $onUpdate source locations: auth (user/session/account/verification),
    // crosscutting (role/dailyPlanItem), identity auditColumns + hub/organization/actor/team.
    await db.update(user).set({ name: 'Ada L.' }).where(eq(user.id, ids['user']!));
    await db.update(session).set({ ipAddress: '127.0.0.1' }).where(eq(session.id, ids['session']!));
    await db.update(account).set({ scope: 'email' }).where(eq(account.id, ids['account']!));
    await db
      .update(verification)
      .set({ value: 'v2' })
      .where(eq(verification.id, ids['verification']!));
    // oauthProvider tables.
    await db
      .update(oauthClient)
      .set({ name: 'Docket MCP v2' })
      .where(eq(oauthClient.id, ids['oauthClient']!));
    await db
      .update(oauthRefreshToken)
      .set({ revoked: new Date() })
      .where(eq(oauthRefreshToken.id, ids['oauthRefreshToken']!));
    await db
      .update(oauthAccessToken)
      .set({ scopes: ['openid'] })
      .where(eq(oauthAccessToken.id, ids['oauthAccessToken']!));
    await db
      .update(oauthConsent)
      .set({ scopes: ['openid'] })
      .where(eq(oauthConsent.id, ids['oauthConsent']!));
    await db.update(role).set({ name: 'Owner v2' }).where(eq(role.id, ids['role']!));
    await db
      .update(dailyPlanItem)
      .set({ status: 'done' })
      .where(eq(dailyPlanItem.id, ids['dailyPlanItem']!));
    await db.update(hub).set({ name: 'Home' }).where(eq(hub.id, ids['hub']!));
    await db.update(organization).set({ name: 'Acme Inc' }).where(eq(organization.id, ids['org']!));
    await db.update(actor).set({ displayName: 'Ada Lovelace' }).where(eq(actor.id, ids['actor']!));
    await db.update(team).set({ name: 'Core Team' }).where(eq(team.id, ids['team']!));
    // auditColumns()-backed table (task spreads auditColumns → its own $onUpdate).
    await db.update(task).set({ title: 'Done thing' }).where(eq(task.id, ids['task']!));

    const refreshed = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, ids['org']!));
    expect(refreshed[0]?.name).toBe('Acme Inc');
  });

  it('stores user-scoped Google Calendar accounts, calendars, and events', async () => {
    const userId = ids['user']!;
    const linkedAccount = (
      await db
        .insert(account)
        .values({ userId, providerId: 'google', accountId: 'google-sub-1' })
        .returning()
    )[0]!;
    const conn = (
      await db
        .insert(calendarConnection)
        .values({
          userId,
          provider: 'google',
          externalAccountId: 'google-sub-1',
          accountEmail: 'ada@example.com',
          accountName: 'Ada Lovelace',
          status: 'connected',
        })
        .returning()
    )[0]!;
    const cal = (
      await db
        .insert(calendarList)
        .values({
          userId,
          connectionId: conn.id,
          externalCalendarId: 'primary',
          title: 'Ada',
          timezone: 'America/Los_Angeles',
          selected: true,
          visibleByDefault: true,
        })
        .returning()
    )[0]!;
    const event = (
      await db
        .insert(calendarEvent)
        .values({
          userId,
          connectionId: conn.id,
          calendarId: cal.id,
          externalCalendarId: 'primary',
          externalEventId: 'event-1',
          status: 'confirmed',
          title: 'Design review',
          startsAt: new Date('2026-06-30T16:00:00.000Z'),
          endsAt: new Date('2026-06-30T17:00:00.000Z'),
          organizer: { email: 'ada@example.com', displayName: 'Ada', self: true },
          attendees: [{ email: 'grace@example.com', responseStatus: 'accepted' }],
        })
        .returning()
    )[0]!;

    expect(event.calendarId).toBe(cal.id);
    expect(event.organizer?.email).toBe('ada@example.com');

    await db.delete(account).where(eq(account.id, linkedAccount.id));
    expect(
      await db.select().from(calendarConnection).where(eq(calendarConnection.id, conn.id)),
    ).toEqual([]);
    expect(await db.select().from(calendarList).where(eq(calendarList.id, cal.id))).toEqual([]);
    expect(await db.select().from(calendarEvent).where(eq(calendarEvent.id, event.id))).toEqual([]);
  });

  it('serves the relational query API built from the full schema', async () => {
    const orgs = await db.query.organization.findFirst({ with: { actors: true, teams: true } });
    expect(orgs?.actors.length).toBeGreaterThan(0);
    expect(orgs?.teams.length).toBeGreaterThan(0);
  });
});
