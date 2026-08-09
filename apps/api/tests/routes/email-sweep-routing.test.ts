/**
 * The mailbox sweep, end to end, for the one email this whole feature was described by:
 * "if I get an email about a limited-time LVBT opportunity, a task appears."
 *
 * @remarks
 * These enter at {@link sweepEmailSuggestions} — the scheduled entrypoint itself, the function
 * cron calls — and nothing downstream is substituted. The threads come from the mock Gmail
 * connector's fixtures, so they travel the whole path: listing → the funnel and its scoring →
 * synthesis → the suggestion row → the real emit facade → the automation engine → `task.route`.
 *
 * That entrypoint is the point. The routing suite in `automation-task-routing.test.ts` covers the
 * same journey from `persistSuggestions` with a fixture worded like ordinary correspondence, which
 * leaves the funnel's own judgement barely exercised: a thread that scores well passes whatever
 * the scorer thinks of promotional wording. The email Willie actually described is worded like
 * promotional mail, because that is how a real limited-time offer is worded, and the funnel used
 * to floor it before any rule could see it. So the fixture here is deliberately the awkward one,
 * and the pair of tests below pins the distinction that makes it work: the same promotional-
 * sounding thread survives when a rule names it and is dropped when nothing does.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { addMember, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import { seedDefaultAutomationRules } from '../../src/lib/automation/rules-store';
import { sweepEmailSuggestions } from '../../src/lib/email-to-task/sweep';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** The mock mailbox's LVBT thread — promotional in wording, an opportunity in substance. */
const LVBT_THREAD_ID = 'gmail-thread-lvbt-opportunity';
/** Its RFC 5322 identity, which is what the routing ledger keys on. */
const LVBT_MESSAGE_ID = '<lvbt-opportunity-0001@showcase.example>';
/** The mock mailbox's genuine bulk-mail thread — the control for "the filter still filters". */
const PROMO_THREAD_ID = 'gmail-thread-promo';

/**
 * A personal workspace with the mailbox connected, an LVBT workspace where LVBT work belongs, and
 * one person who is a member of both — plus the shipped default automation rules, so the sweep
 * runs against the rule set a real newly-connected mailbox actually has.
 *
 * @param threshold - The funnel pass score to configure, as the settings PATCH would write it.
 */
async function seedConnectedMailbox(threshold: number) {
  const personal = await seedBaseOrg(db, schema);
  const lvbt = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, 'Willie');
  const personalActorId = await addMember(db, schema, personal.orgId, userId, 'owner');
  const lvbtActorId = await addMember(db, schema, lvbt.orgId, userId, 'owner');

  // The defaults first, so the sweep's own idempotent seeding is a no-op and the
  // dismiss-promotions rule is live while routing runs. A rescue that only works in a workspace
  // with no promotional filtering configured would not be a rescue.
  await seedDefaultAutomationRules(personal.orgId, personalActorId);

  const integrationId = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: personal.orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        status: 'connected',
        createdBy: personalActorId,
        config: { emailToTask: { enabled: true, threshold } },
      })
      .returning({ id: schema.integration.id }),
  ).id;

  return {
    personalOrgId: personal.orgId,
    personalActorId,
    lvbtOrgId: lvbt.orgId,
    lvbtTeamId: lvbt.teamId,
    lvbtActorId,
    integrationId,
  };
}

/** The rule a person writes for this: LVBT mail is LVBT's work, at high priority. */
async function addLvbtRoutingRule(personalOrgId: string, lvbtOrgId: string): Promise<void> {
  await db.insert(schema.automationRule).values({
    organizationId: personalOrgId,
    name: 'LVBT opportunities → LVBT',
    enabled: true,
    eventMatch: { kind: 'created', subjectType: 'email_suggestion' },
    condition: { op: 'contains', path: 'detail.subject', value: 'LVBT' },
    actions: [{ type: 'task.route', params: { organizationId: lvbtOrgId, priority: 'high' } }],
  });
}

/** Every suggestion this mailbox produced. */
async function suggestionsFor(integrationId: string) {
  return db
    .select()
    .from(schema.emailSuggestion)
    .where(eq(schema.emailSuggestion.integrationId, integrationId));
}

/** Every task in a workspace. */
async function tasksIn(orgId: string) {
  return db.select().from(schema.task).where(eq(schema.task.organizationId, orgId));
}

describe('a limited-time LVBT opportunity arriving in the mailbox becomes an LVBT task', () => {
  it('survives the funnel and lands in the LVBT workspace, from the scheduled sweep inward', async () => {
    // A real threshold, not 0. At 0 nothing is ever dropped and the funnel is not under test.
    const w = await seedConnectedMailbox(50);
    await addLvbtRoutingRule(w.personalOrgId, w.lvbtOrgId);

    await sweepEmailSuggestions(new Date());

    // The funnel kept it. Before the routing-cue exemption this assertion failed here — the
    // subject's "Limited-time" tripped the promotional filter, the thread was floored to 5, and
    // no suggestion was ever written for a rule to match.
    const suggestions = await suggestionsFor(w.integrationId);
    const lvbt = suggestions.find((s) => s.externalThreadId === LVBT_THREAD_ID);
    expect(lvbt).toBeDefined();
    // Scored as something the person asked for, not as junk that squeaked past.
    expect(lvbt?.confidence ?? 0).toBeGreaterThanOrEqual(70);

    // And the rule did what it says: the task is in LVBT, not in the workspace the mailbox is
    // connected to, and it is written under this person's LVBT actor.
    const lvbtTasks = await tasksIn(w.lvbtOrgId);
    expect(lvbtTasks).toHaveLength(1);
    const task = one(lvbtTasks);
    expect(task.title).toContain('Limited-time LVBT opportunity');
    expect(task.priority).toBe('high');
    expect(task.createdBy).toBe(w.lvbtActorId);
    expect(task.teamId).toBe(w.lvbtTeamId);

    // Provenance keyed on the mail's own identity, so a later sweep finds this task rather than
    // opening a second one.
    const routes = await db
      .select()
      .from(schema.inboundTaskRoute)
      .where(eq(schema.inboundTaskRoute.organizationId, w.lvbtOrgId));
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      taskId: task.id,
      sourceSystem: 'gmail',
      sourceKey: LVBT_MESSAGE_ID,
      originOrganizationId: w.personalOrgId,
    });

    // The suggestion is closed out rather than left in the review queue.
    expect(lvbt?.status).toBe('accepted');
    expect(lvbt?.createdTaskId).toBe(task.id);

    // The filter was not gutted to achieve any of that: the genuine bulk-mail fixture, which no
    // rule names, never made it out of the funnel at all.
    expect(suggestions.some((s) => s.externalThreadId === PROMO_THREAD_ID)).toBe(false);
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
  });

  it('drops the very same thread when no rule asks for it — the rule is what makes the difference', async () => {
    // Identical mailbox, identical threshold, identical fixtures. The only thing missing is the
    // routing rule, and without it the promotional wording is all the funnel has to go on.
    const w = await seedConnectedMailbox(50);

    await sweepEmailSuggestions(new Date());

    const suggestions = await suggestionsFor(w.integrationId);
    expect(suggestions.some((s) => s.externalThreadId === LVBT_THREAD_ID)).toBe(false);
    expect(suggestions.some((s) => s.externalThreadId === PROMO_THREAD_ID)).toBe(false);
    // The ordinary actionable thread is unaffected either way — the exemption is scoped to the
    // promotional path, not a general loosening of the funnel.
    expect(suggestions.map((s) => s.externalThreadId)).toEqual(['gmail-thread-actionable']);
    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(0);
  });
});
