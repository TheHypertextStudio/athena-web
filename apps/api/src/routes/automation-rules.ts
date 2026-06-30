/**
 * `@docket/api` — automation-rules router (mounted at `/v1/orgs/:orgId/automation-rules`).
 *
 * @remarks
 * CRUD over the `automation_rule` table — rules are user-owned data (`on → when → then`).
 * The DB stores them as `eventMatch`/`condition`/`actions`; the wire shape uses `on`/`when`/
 * `then`. Default rules ship as `isSeed` rows surfaced here. The engine reads these rows when
 * an observation fires (see `lib/automation`). Mutations require `manage` (org configuration);
 * reads require org membership. See `docs/engineering/specs/email-to-task.md` §7/§8.
 */
import { automationRule, db } from '@docket/db';
import {
  AutomationRuleCreate,
  AutomationRuleOut,
  AutomationRuleRemoved,
  AutomationRuleUpdate,
  pageOf,
} from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type RuleRow = typeof automationRule.$inferSelect;

const idParam = z.object({ id: z.string() });

/** Project a rule row into its wire {@link AutomationRuleOut} shape (DB columns → on/when/then). */
function toOut(r: RuleRow): z.input<typeof AutomationRuleOut> {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    enabled: r.enabled,
    on: r.eventMatch as z.input<typeof AutomationRuleOut>['on'],
    when: r.condition,
    then: r.actions as z.input<typeof AutomationRuleOut>['then'],
    isSeed: r.isSeed,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Load an org-scoped rule or throw. */
async function loadRule(orgId: string, id: string): Promise<RuleRow> {
  const rows = await db
    .select()
    .from(automationRule)
    .where(and(eq(automationRule.id, id), eq(automationRule.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Automation rule not found');
  return row;
}

/** Automation-rules router: list + create + update + delete. */
const automationRules = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(automationRule)
      .where(eq(automationRule.organizationId, orgId))
      .orderBy(asc(automationRule.createdAt));
    return ok(c, pageOf(AutomationRuleOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(AutomationRuleCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const b = c.req.valid('json');
    const inserted = await db
      .insert(automationRule)
      .values({
        organizationId: orgId,
        createdBy: actorId,
        name: b.name,
        enabled: b.enabled,
        eventMatch: b.on,
        condition: b.when,
        actions: b.then,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!row) throw new Error('automation rule insert returned no row');
    return ok(c, AutomationRuleOut, toOut(row));
  })
  .patch(
    '/:id',
    capabilityGuard('manage'),
    zParam(idParam),
    zJson(AutomationRuleUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const b = c.req.valid('json');
      const existing = await loadRule(orgId, id);
      const patch = {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.on !== undefined ? { eventMatch: b.on } : {}),
        ...(b.when !== undefined ? { condition: b.when } : {}),
        ...(b.then !== undefined ? { actions: b.then } : {}),
      };
      if (Object.keys(patch).length === 0) return ok(c, AutomationRuleOut, toOut(existing));
      const updated = await db
        .update(automationRule)
        .set(patch)
        .where(and(eq(automationRule.id, id), eq(automationRule.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: loadRule proved the row exists */
      if (!row) throw new NotFoundError('Automation rule not found');
      return ok(c, AutomationRuleOut, toOut(row));
    },
  )
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const removed = await db
      .delete(automationRule)
      .where(and(eq(automationRule.id, id), eq(automationRule.organizationId, orgId)))
      .returning();
    const row = removed[0];
    if (!row) throw new NotFoundError('Automation rule not found');
    return ok(c, AutomationRuleRemoved, { id: row.id, removed: true });
  });

export default automationRules;
