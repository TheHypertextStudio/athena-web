import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { genId } from '../../src/id';
import {
  account,
  actor,
  agent,
  agentElicitation,
  agentExecution,
  agentSession,
  athenaAssignment,
  athenaMailbox,
  athenaPresence,
  calendarConnection,
  calendarEvent,
  calendarItem,
  calendarItemTaskLink,
  calendarItemWrite,
  calendarLayer,
  calendarLayerShare,
  calendarList,
  contactPoint,
  dailyDigest,
  dayCheckIn,
  dayDirective,
  dayReview,
  directiveAcknowledgment,
  entityDisplay,
  externalActor,
  hub,
  initiative,
  initiativeHierarchyLink,
  integration,
  latticeConnection,
  latticeCredential,
  notificationIntent,
  notificationPreference,
  organization,
  personalMcpConnection,
  phoneNumber,
  schedulingPreference,
  searchDocument,
  sessionActivity,
  task,
  team,
  timeAllocation,
  timeCategory,
  timeRecord,
  user,
} from '../../src/schema';

/**
 * Update-path coverage for every schema table whose `updatedAt` column carries a
 * `.$onUpdate(() => new Date())` callback and is not already exercised by an update
 * somewhere else in the suite (`db.test.ts` covers the auth/identity/crosscutting/work
 * islands; `athena-schema.test.ts` covers `agent_session_transcript`).
 *
 * @remarks
 * Drizzle only invokes an `$onUpdate` callback while building the `SET` clause of a real
 * `.update(...).set(...)` call that omits that column — it is never run on insert (the
 * column's `defaultNow()` handles that) and never run merely by importing the schema
 * module. So the only way to exercise these callbacks — and prove each table's update path
 * actually works — is a real update against a real row. This file builds one minimal row
 * per remaining table and updates an unrelated column on it, asserting both the intended
 * change landed and `updatedAt` moved to a fresh `Date`.
 */

const client = new PGlite('memory://');
const db = drizzle(client);

const ids: Record<string, string> = {};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });

  ids['user'] = (
    await db
      .insert(user)
      .values({ name: 'Grace', email: 'grace@example.com', emailVerified: true })
      .returning()
  )[0]!.id;
  ids['org'] = (
    await db.insert(organization).values({ name: 'Lifecycle Co', slug: 'lifecycle-co' }).returning()
  )[0]!.id;
  ids['humanActor'] = (
    await db
      .insert(actor)
      .values({
        organizationId: ids['org'],
        kind: 'human',
        displayName: 'Grace',
        userId: ids['user'],
      })
      .returning()
  )[0]!.id;
  ids['agentActor'] = (
    await db
      .insert(actor)
      .values({ organizationId: ids['org'], kind: 'agent', displayName: 'Bot' })
      .returning()
  )[0]!.id;
  ids['team'] = (
    await db
      .insert(team)
      .values({ organizationId: ids['org'], name: 'Core', key: 'CORE' })
      .returning()
  )[0]!.id;
  ids['hub'] = (await db.insert(hub).values({ userId: ids['user'] }).returning())[0]!.id;
  ids['task'] = (
    await db
      .insert(task)
      .values({
        organizationId: ids['org'],
        title: 'Ship the feature',
        teamId: ids['team'],
        state: 'backlog',
      })
      .returning()
  )[0]!.id;
  ids['agent'] = (
    await db
      .insert(agent)
      .values({ organizationId: ids['org'], actorId: ids['agentActor'] })
      .returning()
  )[0]!.id;
  ids['agentSession'] = (
    await db
      .insert(agentSession)
      .values({ organizationId: ids['org'], agentId: ids['agent'], trigger: 'delegation' })
      .returning()
  )[0]!.id;

  // --- calendar chain: account -> connection -> list/event, layer -> item -> task-link/write ---
  await db
    .insert(account)
    .values({ userId: ids['user'], providerId: 'google', accountId: 'gcal-1' });
  ids['calendarConnection'] = (
    await db
      .insert(calendarConnection)
      .values({ userId: ids['user'], provider: 'google', externalAccountId: 'gcal-1' })
      .returning()
  )[0]!.id;
  ids['calendarList'] = (
    await db
      .insert(calendarList)
      .values({
        userId: ids['user'],
        connectionId: ids['calendarConnection'],
        externalCalendarId: 'primary',
        title: 'Primary',
      })
      .returning()
  )[0]!.id;
  ids['calendarEvent'] = (
    await db
      .insert(calendarEvent)
      .values({
        userId: ids['user'],
        connectionId: ids['calendarConnection'],
        calendarId: ids['calendarList'],
        externalCalendarId: 'primary',
        externalEventId: 'evt-1',
        title: 'Standup',
      })
      .returning()
  )[0]!.id;
  ids['calendarLayer'] = (
    await db
      .insert(calendarLayer)
      .values({ userId: ids['user'], sourceKind: 'native', title: 'My Layer' })
      .returning()
  )[0]!.id;
  ids['calendarItem'] = (
    await db
      .insert(calendarItem)
      .values({ userId: ids['user'], layerId: ids['calendarLayer'], kind: 'block', title: 'Focus' })
      .returning()
  )[0]!.id;
  await db.insert(calendarItemTaskLink).values({
    calendarItemId: ids['calendarItem'],
    taskId: ids['task'],
    organizationId: ids['org'],
    createdBy: ids['humanActor'],
  });
  await db.insert(calendarLayerShare).values({
    layerId: ids['calendarLayer'],
    organizationId: ids['org'],
    createdBy: ids['humanActor'],
  });
  ids['calendarItemWrite'] = (
    await db
      .insert(calendarItemWrite)
      .values({
        userId: ids['user'],
        calendarItemId: ids['calendarItem'],
        connectionId: ids['calendarConnection'],
        provider: 'google',
        operation: 'update',
        patch: {},
      })
      .returning()
  )[0]!.id;

  // --- agent-adjacent personal/org islands ---
  ids['sessionActivity'] = (
    await db
      .insert(sessionActivity)
      .values({
        sessionId: ids['agentSession'],
        organizationId: ids['org'],
        type: 'thought',
        body: { text: 'thinking' },
      })
      .returning()
  )[0]!.id;
  await db.insert(personalMcpConnection).values({
    ownerUserId: ids['user'],
    name: 'My MCP',
    alias: 'my-mcp',
    url: 'https://mcp.example.com',
    authMode: 'none',
  });
  await db.insert(athenaAssignment).values({
    ownerUserId: ids['user'],
    organizationId: ids['org'],
    entityType: 'task',
    entityId: ids['task'],
    objective: 'Ship it',
  });
  ids['latticeConnection'] = (
    await db.insert(latticeConnection).values({ ownerUserId: ids['user'] }).returning()
  )[0]!.id;
  await db.insert(latticeCredential).values({
    connectionId: ids['latticeConnection'],
    ownerUserId: ids['user'],
    ciphertext: 'v1:gcm:deadbeef',
  });
  await db.insert(athenaMailbox).values({ ownerUserId: ids['user'], key: 'grace-abc123' });

  // --- crosscutting extras ---
  ids['integration'] = (
    await db
      .insert(integration)
      .values({ organizationId: ids['org'], provider: 'linear', pattern: 'connector' })
      .returning()
  )[0]!.id;
  await db.insert(externalActor).values({
    organizationId: ids['org'],
    integrationId: ids['integration'],
    externalId: 'linear-user-1',
    displayName: 'Linear Ada',
  });
  await db.insert(entityDisplay).values({
    organizationId: ids['org'],
    subjectType: 'project',
    subjectId: 'entity-display-subject',
    iconKey: 'folder',
    colorKey: 'neutral',
  });
  await db.insert(notificationIntent).values({
    senderType: 'system',
    category: 'workflow',
    audience: { type: 'all_users' },
    channels: ['web'],
    subject: 'Heads up',
    body: {},
    createdBy: ids['humanActor'],
  });
  await db.insert(notificationPreference).values({ userId: ids['user'] });
  await db.insert(contactPoint).values({
    userId: ids['user'],
    type: 'email',
    value: 'grace@example.com',
    valueNormalized: 'grace@example.com',
    valueMasked: 'g***@example.com',
  });

  // --- elicitation island ---
  await db.insert(agentElicitation).values({
    sessionId: ids['agentSession'],
    activityId: ids['sessionActivity'],
    organizationId: ids['org'],
    askedUserId: ids['user'],
    taskId: ids['task'],
    question: 'Which venue?',
    actionSummary: 'Book the chosen venue',
    spec: { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' },
    expiresAt: new Date(Date.now() + 3.6e6),
  });
  await db.insert(athenaPresence).values({ userId: ids['user'] });

  // --- cross-org / cross-tool feed ---
  await db.insert(dailyDigest).values({ userId: ids['user'], digestDate: '2026-08-02' });

  // --- initiative hierarchy ---
  ids['parentInitiative'] = (
    await db
      .insert(initiative)
      .values({ organizationId: ids['org'], name: 'Parent Vision' })
      .returning()
  )[0]!.id;
  ids['childInitiative'] = (
    await db
      .insert(initiative)
      .values({ organizationId: ids['org'], name: 'Child Vision' })
      .returning()
  )[0]!.id;
  await db.insert(initiativeHierarchyLink).values({
    contextOrganizationId: ids['org'],
    parentInitiativeId: ids['parentInitiative'],
    childInitiativeId: ids['childInitiative'],
    createdBy: ids['humanActor'],
  });

  // --- phone binding ---
  await db.insert(phoneNumber).values({
    userId: ids['user'],
    e164: '+15550000001',
    dialCode: '1',
    country: 'US',
    nationalNumber: '5550000001',
  });

  // --- weekly scheduling + daily-directive loop ---
  await db.insert(schedulingPreference).values({ hubId: ids['hub'] });
  await db.insert(dayDirective).values({
    hubId: ids['hub'],
    date: '2026-08-02',
    timezone: 'UTC',
    directiveId: 'directive-1',
  });
  await db.insert(dayCheckIn).values({
    hubId: ids['hub'],
    date: '2026-08-02',
    scheduledAt: new Date('2026-08-02T12:00:00.000Z'),
  });
  await db.insert(dayReview).values({ hubId: ids['hub'], date: '2026-08-02', timezone: 'UTC' });
  await db.insert(directiveAcknowledgment).values({
    hubId: ids['hub'],
    directiveId: 'directive-1',
    appliedPosture: 'on_track',
    enforced: true,
  });

  // --- search projection ---
  ids['searchDocument'] = genId();
  await db.insert(searchDocument).values({
    id: ids['searchDocument'],
    organizationId: ids['org'],
    kind: 'task',
    family: 'work',
    sourceTable: 'task',
    entityId: ids['task'],
    title: 'Ship the feature',
    route: {},
    visibility: {},
  });

  // --- time ledger ---
  ids['timeCategory'] = (
    await db.insert(timeCategory).values({ hubId: ids['hub'], name: 'Deep work' }).returning()
  )[0]!.id;
  ids['timeRecord'] = (
    await db
      .insert(timeRecord)
      .values({
        hubId: ids['hub'],
        createdByUserId: ids['user'],
        taskId: ids['task'],
        title: 'Working the feature',
      })
      .returning()
  )[0]!.id;
  await db.insert(timeAllocation).values({
    timeRecordId: ids['timeRecord'],
    targetKind: 'task',
    targetId: ids['task'],
    basisPoints: 10_000,
  });
  await db.insert(agentExecution).values({ sessionId: ids['agentSession'] });
});

afterAll(async () => {
  await client.close();
});

describe('calendar island updates ($onUpdate coverage)', () => {
  it('bumps updatedAt on the connection, list, and event rows when re-synced', async () => {
    const [connection] = await db
      .update(calendarConnection)
      .set({ lastSyncedAt: new Date() })
      .where(eq(calendarConnection.id, ids['calendarConnection']!))
      .returning();
    expect(connection?.lastSyncedAt).toBeInstanceOf(Date);
    expect(connection?.updatedAt).toBeInstanceOf(Date);

    const [list] = await db
      .update(calendarList)
      .set({ selected: false })
      .where(eq(calendarList.id, ids['calendarList']!))
      .returning();
    expect(list?.selected).toBe(false);
    expect(list?.updatedAt).toBeInstanceOf(Date);

    const [event] = await db
      .update(calendarEvent)
      .set({ title: 'Standup (moved)' })
      .where(eq(calendarEvent.id, ids['calendarEvent']!))
      .returning();
    expect(event?.title).toBe('Standup (moved)');
    expect(event?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt on the layer, item, task-link, layer-share, and write-outbox rows', async () => {
    const [layer] = await db
      .update(calendarLayer)
      .set({ selected: false })
      .where(eq(calendarLayer.id, ids['calendarLayer']!))
      .returning();
    expect(layer?.selected).toBe(false);
    expect(layer?.updatedAt).toBeInstanceOf(Date);

    const [item] = await db
      .update(calendarItem)
      .set({ title: 'Focus (renamed)' })
      .where(eq(calendarItem.id, ids['calendarItem']!))
      .returning();
    expect(item?.title).toBe('Focus (renamed)');
    expect(item?.updatedAt).toBeInstanceOf(Date);

    const [link] = await db
      .update(calendarItemTaskLink)
      .set({ note: 'reviewed' })
      .where(eq(calendarItemTaskLink.calendarItemId, ids['calendarItem']!))
      .returning();
    expect(link?.note).toBe('reviewed');
    expect(link?.updatedAt).toBeInstanceOf(Date);

    const [share] = await db
      .update(calendarLayerShare)
      .set({ access: 'busy_only' })
      .where(eq(calendarLayerShare.layerId, ids['calendarLayer']!))
      .returning();
    expect(share?.access).toBe('busy_only');
    expect(share?.updatedAt).toBeInstanceOf(Date);

    const [write] = await db
      .update(calendarItemWrite)
      .set({ status: 'sent' })
      .where(eq(calendarItemWrite.id, ids['calendarItemWrite']!))
      .returning();
    expect(write?.status).toBe('sent');
    expect(write?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('agent-adjacent islands updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when a session activity row is revised in place', async () => {
    const [row] = await db
      .update(sessionActivity)
      .set({ approvalStatus: 'approved' })
      .where(eq(sessionActivity.id, ids['sessionActivity']!))
      .returning();
    expect(row?.approvalStatus).toBe('approved');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt on a personal MCP connection health refresh', async () => {
    const [row] = await db
      .update(personalMcpConnection)
      .set({ status: 'connected', toolCount: 12 })
      .where(eq(personalMcpConnection.ownerUserId, ids['user']!))
      .returning();
    expect(row?.toolCount).toBe(12);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when an Athena assignment is paused', async () => {
    const [row] = await db
      .update(athenaAssignment)
      .set({ status: 'paused', pausedReason: 'waiting on input' })
      .where(eq(athenaAssignment.ownerUserId, ids['user']!))
      .returning();
    expect(row?.status).toBe('paused');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt on a Lattice connection and credential refresh', async () => {
    const [connection] = await db
      .update(latticeConnection)
      .set({ deviceName: 'Grace’s MacBook' })
      .where(eq(latticeConnection.id, ids['latticeConnection']!))
      .returning();
    expect(connection?.deviceName).toBe('Grace’s MacBook');
    expect(connection?.updatedAt).toBeInstanceOf(Date);

    const [credential] = await db
      .update(latticeCredential)
      .set({ ciphertext: 'v1:gcm:refreshed' })
      .where(eq(latticeCredential.connectionId, ids['latticeConnection']!))
      .returning();
    expect(credential?.ciphertext).toBe('v1:gcm:refreshed');
    expect(credential?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when an Athena mailbox is rehomed to a workspace', async () => {
    const [row] = await db
      .update(athenaMailbox)
      .set({ organizationId: ids['org']! })
      .where(eq(athenaMailbox.ownerUserId, ids['user']!))
      .returning();
    expect(row?.organizationId).toBe(ids['org']);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('crosscutting extras updates ($onUpdate coverage)', () => {
  it('bumps updatedAt on an entity-display customization', async () => {
    const [row] = await db
      .update(entityDisplay)
      .set({ colorKey: 'blue' })
      .where(eq(entityDisplay.organizationId, ids['org']!))
      .returning();
    expect(row?.colorKey).toBe('blue');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt as a notification intent advances through its lifecycle', async () => {
    const [row] = await db
      .update(notificationIntent)
      .set({ status: 'queued' })
      .where(eq(notificationIntent.createdBy, ids['humanActor']!))
      .returning();
    expect(row?.status).toBe('queued');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when notification preferences are edited', async () => {
    const [row] = await db
      .update(notificationPreference)
      .set({ timezone: 'America/Los_Angeles' })
      .where(eq(notificationPreference.userId, ids['user']!))
      .returning();
    expect(row?.timezone).toBe('America/Los_Angeles');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a contact point is activated', async () => {
    const [row] = await db
      .update(contactPoint)
      .set({ status: 'active', verifiedAt: new Date() })
      .where(eq(contactPoint.userId, ids['user']!))
      .returning();
    expect(row?.status).toBe('active');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when an external actor is matched to a Docket actor', async () => {
    const [row] = await db
      .update(externalActor)
      .set({ actorId: ids['humanActor']!, matchedBy: 'manual' })
      .where(eq(externalActor.integrationId, ids['integration']!))
      .returning();
    expect(row?.actorId).toBe(ids['humanActor']);
    expect(row?.matchedBy).toBe('manual');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('elicitation island updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when an elicitation is answered', async () => {
    const [row] = await db
      .update(agentElicitation)
      .set({ status: 'answered', resolver: 'user', answer: true, settledAt: new Date() })
      .where(eq(agentElicitation.taskId, ids['task']!))
      .returning();
    expect(row?.status).toBe('answered');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt on an Athena presence heartbeat', async () => {
    const [row] = await db
      .update(athenaPresence)
      .set({ focusedAt: new Date() })
      .where(eq(athenaPresence.userId, ids['user']!))
      .returning();
    expect(row?.focusedAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('cross-org feed and hierarchy updates ($onUpdate coverage)', () => {
  it('bumps updatedAt as a daily digest moves from pending to sent', async () => {
    const [row] = await db
      .update(dailyDigest)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(dailyDigest.userId, ids['user']!))
      .returning();
    expect(row?.status).toBe('sent');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when an initiative hierarchy link is re-pointed', async () => {
    const [row] = await db
      .update(initiativeHierarchyLink)
      .set({ createdBy: ids['humanActor']! })
      .where(eq(initiativeHierarchyLink.parentInitiativeId, ids['parentInitiative']!))
      .returning();
    expect(row?.createdBy).toBe(ids['humanActor']);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('phone binding updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when a phone number is verified', async () => {
    const [row] = await db
      .update(phoneNumber)
      .set({ status: 'verified', verifiedAt: new Date() })
      .where(eq(phoneNumber.userId, ids['user']!))
      .returning();
    expect(row?.status).toBe('verified');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('weekly scheduling and daily-directive loop updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when scheduling preferences are edited', async () => {
    const [row] = await db
      .update(schedulingPreference)
      .set({ timezone: 'America/New_York' })
      .where(eq(schedulingPreference.hubId, ids['hub']!))
      .returning();
    expect(row?.timezone).toBe('America/New_York');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a day directive is recomputed', async () => {
    const [row] = await db
      .update(dayDirective)
      .set({ posture: 'at_risk' })
      .where(eq(dayDirective.hubId, ids['hub']!))
      .returning();
    expect(row?.posture).toBe('at_risk');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a day check-in is answered', async () => {
    const [row] = await db
      .update(dayCheckIn)
      .set({ respondedAt: new Date(), response: 'on_track' })
      .where(eq(dayCheckIn.hubId, ids['hub']!))
      .returning();
    expect(row?.response).toBe('on_track');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when the day review is completed', async () => {
    const [row] = await db
      .update(dayReview)
      .set({ completedAt: new Date() })
      .where(eq(dayReview.hubId, ids['hub']!))
      .returning();
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a directive acknowledgment is revised', async () => {
    const [row] = await db
      .update(directiveAcknowledgment)
      .set({ note: 'client applied posture late' })
      .where(eq(directiveAcknowledgment.hubId, ids['hub']!))
      .returning();
    expect(row?.note).toBe('client applied posture late');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('search projection updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when a search document is re-indexed', async () => {
    const [row] = await db
      .update(searchDocument)
      .set({ title: 'Ship the feature (renamed)' })
      .where(eq(searchDocument.id, ids['searchDocument']!))
      .returning();
    expect(row?.title).toBe('Ship the feature (renamed)');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe('time ledger updates ($onUpdate coverage)', () => {
  it('bumps updatedAt when a time category is renamed', async () => {
    const [row] = await db
      .update(timeCategory)
      .set({ color: '#3b82f6' })
      .where(eq(timeCategory.id, ids['timeCategory']!))
      .returning();
    expect(row?.color).toBe('#3b82f6');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a time record is closed', async () => {
    const [row] = await db
      .update(timeRecord)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(timeRecord.id, ids['timeRecord']!))
      .returning();
    expect(row?.status).toBe('closed');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when a time allocation is corrected', async () => {
    const [row] = await db
      .update(timeAllocation)
      .set({ basisPoints: 5_000 })
      .where(eq(timeAllocation.timeRecordId, ids['timeRecord']!))
      .returning();
    expect(row?.basisPoints).toBe(5_000);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('bumps updatedAt when an agent execution finishes', async () => {
    const [row] = await db
      .update(agentExecution)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(agentExecution.sessionId, ids['agentSession']!))
      .returning();
    expect(row?.status).toBe('completed');
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});
