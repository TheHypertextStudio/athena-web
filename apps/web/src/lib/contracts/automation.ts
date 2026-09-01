/**
 * `domain packages` — Automation Rules DTOs and compatibility exports.
 *
 * @remarks
 * Automation owns the portable `on → when → then` grammar. This module deliberately keeps a
 * one-way compatibility facade for established API DTOs, which add branded identifiers and
 * transport lifecycle fields around that grammar.
 */
import {
  ActionSpec,
  AutomationEventMatch,
  AutomationRule,
  Predicate,
  PredicateLeafOp,
  PredicateValue,
} from '@docket/automation/contracts';
import { z } from 'zod';

import { AutomationRuleId } from '@docket/automation/ids';
import { OrganizationId } from '@docket/identity-access/ids';

/** Compatibility exports for the Automation-owned portable rule grammar. */
export {
  ActionSpec,
  AutomationEventMatch,
  AutomationRule,
  Predicate,
  PredicateLeafOp,
  PredicateValue,
};

/** Body for creating an automation rule. */
export const AutomationRuleCreate = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
  })
  .meta({ id: 'AutomationRuleCreate', description: 'Create an automation rule.' });
/** Automation-rule-create value. */
export type AutomationRuleCreate = z.infer<typeof AutomationRuleCreate>;

/** Body for updating an automation rule (any subset of fields). */
export const AutomationRuleUpdate = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    on: AutomationEventMatch.optional(),
    when: Predicate.optional(),
    then: z.array(ActionSpec).optional(),
  })
  .meta({ id: 'AutomationRuleUpdate', description: 'Update an automation rule.' });
/** Automation-rule-update value. */
export type AutomationRuleUpdate = z.infer<typeof AutomationRuleUpdate>;

/** Acknowledgement returned when an automation rule is removed. */
export const AutomationRuleRemoved = z
  .object({ id: AutomationRuleId, removed: z.literal(true) })
  .meta({ id: 'AutomationRuleRemoved', description: 'A removed-rule acknowledgement.' });
/** Removal acknowledgement value. */
export type AutomationRuleRemoved = z.infer<typeof AutomationRuleRemoved>;

/** Full automation-rule representation returned by reads. */
export const AutomationRuleOut = z
  .object({
    id: AutomationRuleId,
    organizationId: OrganizationId,
    name: z.string(),
    enabled: z.boolean(),
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
    isSeed: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'AutomationRuleOut', description: 'An automation rule.' });
/** Automation-rule representation value. */
export type AutomationRuleOut = z.infer<typeof AutomationRuleOut>;
