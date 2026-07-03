/**
 * `@docket/api` — automation rule store: load rules from the DB into the engine's shape,
 * and seed the shipped default rules.
 *
 * @remarks
 * Rules live in the `automation_rule` table as `eventMatch`/`condition`/`actions`; the engine
 * consumes them as {@link EngineRule} (`on`/`when`/`then`). Defaults ship as `isSeed` rows —
 * data, not code branches — so a user can edit or delete them. See `docs/engineering/specs/automations.md`.
 */
import { automationRule, db } from '@docket/db';
import type { ActionSpec, AutomationEventMatch, Predicate } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';

import type { EngineRule } from './engine';

type RuleRow = typeof automationRule.$inferSelect;

/** Map an `automation_rule` row into the engine's {@link EngineRule} shape. */
export function rowToEngineRule(r: RuleRow): EngineRule {
  return {
    enabled: r.enabled,
    on: r.eventMatch as AutomationEventMatch,
    when: r.condition as Predicate,
    then: r.actions as ActionSpec[],
  };
}

/** Load the org's enabled, non-archived automation rules as engine rules. */
export async function loadEnabledRules(orgId: string): Promise<EngineRule[]> {
  const rows = await db
    .select()
    .from(automationRule)
    .where(
      and(
        eq(automationRule.organizationId, orgId),
        eq(automationRule.enabled, true),
        isNull(automationRule.archivedAt),
      ),
    );
  return rows.map(rowToEngineRule);
}

/** One shipped default rule (seeded per org as an editable `isSeed` row). */
export interface DefaultRule {
  readonly name: string;
  readonly on: AutomationEventMatch;
  readonly when: Predicate;
  readonly then: readonly ActionSpec[];
}

/**
 * The shipped default rule set — DATA, not code.
 *
 * @remarks
 * Seeded as editable `isSeed` rows; a user may change or delete any of them. These encode
 * the conservative "Inbox Zero"-style defaults from the spec without baking policy into the
 * engine.
 */
export const DEFAULT_RULES: readonly DefaultRule[] = [
  {
    name: 'Archive the email when its task is completed',
    on: { kind: 'completed', subjectType: 'task' },
    when: { op: 'and', nodes: [] }, // always; the mail.archive handler no-ops if no email attachment
    then: [{ type: 'mail.archive', params: {} }],
  },
  {
    name: 'Dismiss promotional email suggestions',
    on: { kind: 'created', subjectType: 'email_suggestion' },
    when: { op: 'eq', path: 'detail.category', value: 'promotions' },
    then: [{ type: 'suggestion.dismiss', params: {} }],
  },
];

/**
 * Seed the default rules for an org, once.
 *
 * @remarks
 * Idempotent: if the org already has any rule rows, this is a no-op (so it can be called on
 * org bootstrap or first Gmail connect without duplicating). Returns how many rows it created.
 *
 * @param orgId - The org to seed.
 * @param actorId - The actor recorded as `createdBy`.
 */
export async function seedDefaultAutomationRules(
  orgId: string,
  actorId: string | null,
): Promise<number> {
  const existing = await db
    .select({ id: automationRule.id })
    .from(automationRule)
    .where(eq(automationRule.organizationId, orgId))
    .limit(1);
  if (existing.length > 0) return 0;

  await db.insert(automationRule).values(
    DEFAULT_RULES.map((r) => ({
      organizationId: orgId,
      createdBy: actorId,
      name: r.name,
      enabled: true,
      eventMatch: r.on,
      condition: r.when,
      actions: [...r.then],
      isSeed: true,
    })),
  );
  return DEFAULT_RULES.length;
}
