/**
 * `@docket/api` — automation-rules router (mounted at `/v1/orgs/:orgId/automation-rules`).
 *
 * @remarks
 * CRUD over the `automation_rule` table — rules are user-owned data (`on → when → then`).
 * The DB stores them as `eventMatch`/`condition`/`actions`; the wire shape uses `on`/`when`/
 * `then`. Default rules ship as `isSeed` rows surfaced here. The engine reads these rows when a
 * committed event is projected (see `lib/automation`). Mutations require `manage` (org
 * configuration); reads require org membership. See `docs/engineering/specs/automations.md`.
 */
import { automationRule, db } from '@docket/db';
import {
  AutomationRuleCreate,
  AutomationRuleOut,
  AutomationRuleRemoved,
  AutomationRuleUpdate,
} from '../contracts/automation';
import { pageOf } from '../contracts/pagination';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
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
  .get(
    '/',
    apiDoc({
      tag: 'Automations',
      summary: 'List automation rules',
      response: pageOf(AutomationRuleOut),
      description: `List every automation rule in the org, oldest-first, as a page of {@link AutomationRuleOut}. The order is deliberate: rules are evaluated in creation order, so reading them in that order shows the sequence the engine will apply.

Seeded defaults are included and carry \`isSeed: true\` — enabling \`emailToTask\` on a connector writes them once (see \`PATCH /orgs/{orgId}/integrations/{id}\`), and a client should present them as Docket's defaults rather than as rules the workspace wrote. A rule that has been switched off is still returned, with \`enabled: false\`; nothing is hidden by state. Org membership suffices to read. Related: \`POST /\` to add one.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(automationRule)
        .where(eq(automationRule.organizationId, orgId))
        .orderBy(asc(automationRule.createdAt));
      return ok(c, pageOf(AutomationRuleOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Automations',
      summary: 'Create an automation rule',
      capability: 'manage',
      status: 201,
      response: AutomationRuleOut,
      description: `Create an automation rule and return it as {@link AutomationRuleOut}, with **201 Created** and a \`Location\` header naming the new rule.

The body is the \`on → when → then\` triple: \`on\` is the observation to match, \`when\` is the optional condition that narrows it, and \`then\` is the ordered list of actions to take. The rule takes effect on the next matching observation — it is never applied retroactively to work that already happened.

Requires \`manage\`. A rule runs against work its author may never look at again, which is org configuration rather than a contribution, so the bar is the same as changing roles or integrations. Related: \`PATCH /{id}\` to edit or disable one, \`DELETE /{id}\` to remove it.`,
    }),
    zJson(AutomationRuleCreate),
    async (c) => {
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
      return created(c, AutomationRuleOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Automations',
      summary: 'Update an automation rule',
      capability: 'manage',
      response: AutomationRuleOut,
      description: `Partially update a rule — any of \`name\`, \`enabled\`, \`on\`, \`when\`, \`then\` — and return the refreshed {@link AutomationRuleOut}. Absent fields are left alone; a body with no recognized field is a no-op that returns the rule unchanged rather than an error, so a client that computes an empty diff need not special-case it.

\`enabled: false\` is the reversible way to stop a rule: it stays listed and keeps its configuration, and re-enabling it needs no re-authoring. Prefer it to \`DELETE\` whenever the rule might come back. Editing a seeded rule is allowed and does not clear \`isSeed\`, which records where the rule came from rather than whether it has been touched.

A missing or cross-tenant id 404s. Requires \`manage\`.`,
    }),
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
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Automations',
      summary: 'Delete an automation rule',
      capability: 'manage',
      response: AutomationRuleRemoved,
      description: `Permanently remove a rule and return {@link AutomationRuleRemoved}. Unlike work items, which archive, a rule is a piece of configuration with no history worth keeping, so the row is genuinely deleted. Work the rule already produced is untouched — deleting the rule stops future runs and rewrites nothing.

Deleting a seeded rule is allowed, and it does not come back on its own: the seeding step runs once per org when \`emailToTask\` is first enabled, not on every sync. To silence a rule you may want later, \`PATCH\` it with \`enabled: false\` instead.

A missing or cross-tenant id 404s. Requires \`manage\`.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const removed = await db
        .delete(automationRule)
        .where(and(eq(automationRule.id, id), eq(automationRule.organizationId, orgId)))
        .returning();
      const row = removed[0];
      if (!row) throw new NotFoundError('Automation rule not found');
      return ok(c, AutomationRuleRemoved, { id: row.id, removed: true });
    },
  );

export default automationRules;
