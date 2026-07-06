import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { genId } from '../src/id';
import { fullSchema, type Database } from '../src/client';
import {
  account,
  actor,
  actorKind,
  agent,
  agentSession,
  auditEvent,
  auditEventType,
  calendarConnection,
  calendarEvent,
  calendarList,
  comment,
  contactPoint,
  cycle,
  dailyPlanItem,
  grant,
  hub,
  idempotencyKey,
  impersonationSession,
  initiative,
  initiativeProgram,
  initiativeProject,
  integration,
  invitation,
  label,
  lifecycleHold,
  milestone,
  notification,
  notificationDelivery,
  notificationInboundEvent,
  notificationIntent,
  notificationPreference,
  notificationRecipient,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  operatorAuditEvent,
  organization,
  passkey,
  program,
  project,
  resourceKind,
  role,
  savedView,
  session,
  sessionActivity,
  staffUser,
  task,
  taskDependency,
  taskLabel,
  team,
  teamMember,
  update,
  user,
  verification,
} from '../src/schema';
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
} from '../src/types';
import { actorRelations, organizationRelations } from '../src/relations';

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
  });

  it('lets the jsonb $type shapes be constructed', () => {
    const state: WorkflowState = { key: 'k', name: 'K', type: 'started', position: 0 };
    const stType: WorkflowStateType = 'completed';
    const skin: VocabularySkin = {
      preset: 'agency',
      overrides: { task: { singular: 'Ticket', plural: 'Tickets' } },
    };
    const landing: HubLanding = { orgId: 'org_1' };
    const prefs: HubPreferences = { landing, density: 'compact', theme: 'dark', timezone: 'UTC' };
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
  // Every declared table. `getTableConfig(t).foreignKeys[i].reference()` invokes each
  // table's lazy `() => other.col` FK callback — these are not run on import.
  const allTables: Record<string, PgTable> = {
    user,
    session,
    account,
    verification,
    passkey,
    oauthApplication,
    oauthAccessToken,
    oauthConsent,
    hub,
    organization,
    actor,
    team,
    teamMember,
    invitation,
    role,
    grant,
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
    calendarConnection,
    calendarList,
    calendarEvent,
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
    taskLabel,
    taskDependency,
    agent,
    agentSession,
    sessionActivity,
    staffUser,
    impersonationSession,
    lifecycleHold,
    operatorAuditEvent,
    idempotencyKey,
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
});

describe('schema inserts + updates (covers $defaultFn + $onUpdate callbacks)', () => {
  let db!: Database;
  let client: PGlite | undefined;
  // Shared ids threaded through the FK graph.
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    client = new PGlite('memory://');
    const d = drizzle(client, { schema: fullSchema });
    await migrate(d, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
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
    // oidc/mcp oauth island: application → access-token + consent (FK on clientId).
    const oauthClientId = 'docket-mcp-client';
    ids['oauthApplication'] = (
      await db
        .insert(oauthApplication)
        .values({
          name: 'Docket MCP',
          clientId: oauthClientId,
          clientSecret: 'sec',
          redirectUrls: 'https://docket.example/callback',
          type: 'web',
          userId: ids['user'],
        })
        .returning()
    )[0]!.id;
    ids['oauthAccessToken'] = (
      await db
        .insert(oauthAccessToken)
        .values({
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          accessTokenExpiresAt: new Date(Date.now() + 3.6e6),
          refreshTokenExpiresAt: new Date(Date.now() + 8.64e7),
          clientId: oauthClientId,
          userId: ids['user'],
          scopes: 'openid profile',
        })
        .returning()
    )[0]!.id;
    ids['oauthConsent'] = (
      await db
        .insert(oauthConsent)
        .values({
          clientId: oauthClientId,
          userId: ids['user'],
          scopes: 'openid profile',
          consentGiven: true,
        })
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
    // oidc/mcp oauth tables ($onUpdate on updated_at).
    await db
      .update(oauthApplication)
      .set({ name: 'Docket MCP v2' })
      .where(eq(oauthApplication.id, ids['oauthApplication']!));
    await db
      .update(oauthAccessToken)
      .set({ scopes: 'openid' })
      .where(eq(oauthAccessToken.id, ids['oauthAccessToken']!));
    await db
      .update(oauthConsent)
      .set({ consentGiven: false })
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
  });

  it('serves the relational query API built from the full schema', async () => {
    const orgs = await db.query.organization.findFirst({ with: { actors: true, teams: true } });
    expect(orgs?.actors.length).toBeGreaterThan(0);
    expect(orgs?.teams.length).toBeGreaterThan(0);
  });
});
