/**
 * Reading routing rules back as funnel evidence — mostly a test of what is *not* collected.
 *
 * @remarks
 * The exemption these cues drive relaxes the promotional filter, so the interesting question is
 * never "does an LVBT rule yield an lvbt cue" (it obviously does) but which rules are refused a
 * say: a rule that dismisses mail, a clause that excludes it, a condition on the classifier's own
 * output. Each of those, collected by mistake, would quietly widen the hole.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, seedBaseOrg } from '../../support/routes-harness';
import { loadMailRoutingCues, ruleRoutingCues } from '../../../src/lib/automation/routing-cues';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** The `on` clause every mail rule shares. */
const ON_MAIL = { kind: 'created', subjectType: 'email_suggestion' } as const;
/** The action that means "make work out of this". */
const ROUTE = [{ type: 'task.route', params: {} }];

describe('ruleRoutingCues', () => {
  it('lifts the sender and keyword literals a routing rule names', () => {
    expect(
      ruleRoutingCues({
        on: ON_MAIL,
        when: {
          op: 'or',
          nodes: [
            { op: 'contains', path: 'detail.subject', value: 'LVBT' },
            { op: 'eq', path: 'detail.sender', value: 'Partnerships@Showcase.example' },
            { op: 'contains', path: 'detail.snippet', value: 'sponsor slot' },
          ],
        },
        then: ROUTE,
      }),
    ).toEqual([
      { field: 'content', value: 'lvbt' },
      { field: 'sender', value: 'partnerships@showcase.example' },
      { field: 'content', value: 'sponsor slot' },
    ]);
  });

  it('ignores a rule that dismisses mail rather than making work of it', () => {
    // Reading this as interest would invert the person's meaning: they asked for it to go away.
    expect(
      ruleRoutingCues({
        on: ON_MAIL,
        when: { op: 'contains', path: 'detail.subject', value: 'webinar' },
        then: [{ type: 'suggestion.dismiss', params: {} }],
      }),
    ).toEqual([]);
  });

  it('ignores a rule that is not about inbound mail at all', () => {
    expect(
      ruleRoutingCues({
        on: { kind: 'created', source: 'github' },
        when: { op: 'contains', path: 'detail.subject', value: 'LVBT' },
        then: ROUTE,
      }),
    ).toEqual([]);
  });

  it('skips negated clauses, which describe mail the rule excludes', () => {
    expect(
      ruleRoutingCues({
        on: ON_MAIL,
        when: {
          op: 'and',
          nodes: [
            { op: 'contains', path: 'detail.subject', value: 'LVBT' },
            { op: 'not', node: { op: 'contains', path: 'detail.snippet', value: 'webinar' } },
          ],
        },
        then: ROUTE,
      }),
    ).toEqual([{ field: 'content', value: 'lvbt' }]);
  });

  it('skips conditions on the classifier’s own output, which would be circular', () => {
    expect(
      ruleRoutingCues({
        on: ON_MAIL,
        when: {
          op: 'and',
          nodes: [
            { op: 'eq', path: 'detail.category', value: 'promotions' },
            { op: 'gte', path: 'detail.confidence', value: 80 },
            { op: 'neq', path: 'detail.sender', value: 'spam@x.test' },
          ],
        },
        then: ROUTE,
      }),
    ).toEqual([]);
  });

  it('drops an empty literal, which would match every thread ever listed', () => {
    expect(
      ruleRoutingCues({
        on: ON_MAIL,
        when: { op: 'contains', path: 'detail.subject', value: '   ' },
        then: ROUTE,
      }),
    ).toEqual([]);
  });
});

describe('loadMailRoutingCues', () => {
  it('collects across a workspace’s enabled rules and says the same thing once', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const rule = (name: string, value: string, enabled = true) => ({
      organizationId: orgId,
      createdBy: humanActorId,
      name,
      enabled,
      eventMatch: ON_MAIL,
      condition: { op: 'contains', path: 'detail.subject', value },
      actions: ROUTE,
    });
    await db.insert(schema.automationRule).values([
      rule('LVBT → LVBT', 'LVBT'),
      rule('LVBT, again', 'lvbt'), // two rules, one cue
      rule('Invoices → Finance', 'invoice'),
      rule('Paused', 'archived-idea', false),
    ]);

    expect(await loadMailRoutingCues(orgId)).toEqual([
      { field: 'content', value: 'lvbt' },
      { field: 'content', value: 'invoice' },
    ]);
  });

  it('returns nothing for a workspace with no routing rules, leaving the funnel untouched', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    expect(await loadMailRoutingCues(orgId)).toEqual([]);
  });

  it('does not read another workspace’s rules', async () => {
    const owner = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    await db.insert(schema.automationRule).values({
      organizationId: owner.orgId,
      createdBy: owner.humanActorId,
      name: 'LVBT → LVBT',
      enabled: true,
      eventMatch: ON_MAIL,
      condition: { op: 'contains', path: 'detail.subject', value: 'LVBT' },
      actions: ROUTE,
    });
    expect(await loadMailRoutingCues(other.orgId)).toEqual([]);
    // And an archived rule stops speaking for the workspace that owns it.
    await db
      .update(schema.automationRule)
      .set({ archivedAt: new Date() })
      .where(eq(schema.automationRule.organizationId, owner.orgId));
    expect(await loadMailRoutingCues(owner.orgId)).toEqual([]);
  });
});
