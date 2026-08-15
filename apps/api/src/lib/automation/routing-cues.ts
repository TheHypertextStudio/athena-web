/**
 * `@docket/api` — reading a mailbox's routing rules back as funnel evidence.
 *
 * @remarks
 * Ingestion runs in one direction — funnel, synthesize, emit, then rules — which means the funnel
 * decides what to throw away before any rule has been consulted. That ordering is right for cost
 * (it keeps the paid synthesis off obvious junk) and wrong for intent: a person who has written
 * "mail mentioning LVBT belongs in the LVBT workspace" has told the system that such mail matters,
 * and the funnel was deaf to it.
 *
 * This module is the one back-channel that closes that gap. It reads the org's active mail-routing
 * rules and projects each one down to the literals it names — a sender, a keyword — as
 * {@link RoutingCue}s the funnel can compare cheaply. The funnel stays pure and stays ignorant of
 * automation; it is handed cues, it does not go looking for them.
 *
 * Two restrictions keep this from becoming a hole in the promotional filter:
 *
 * - Only rules that **create work** count. A rule whose actions are `suggestion.dismiss` names mail
 *   the person wants *gone*; treating its keywords as interest would invert the person's meaning.
 * - Only **positive** clauses count. A cue under a `not` describes mail the rule excludes, so it is
 *   evidence against interest and is skipped rather than collected.
 *
 * See `docs/engineering/specs/automations.md` and `docs/engineering/specs/email-to-task.md` §6.
 */
import { automationRule, db } from '@docket/db';
import type { ActionSpec, AutomationEventMatch, Predicate } from '@docket/automation/contracts';
import { and, eq, isNull } from 'drizzle-orm';

import type { RoutingCue } from '../email-to-task/funnel';

/** The action types that mean "this mail should become work", and so imply interest in it. */
const WORK_CREATING_ACTIONS: ReadonlySet<string> = new Set(['task.route']);

/**
 * The event-detail paths a mail rule uses to name the mail it wants, mapped to the part of the
 * thread the funnel should compare them against.
 *
 * @remarks
 * These are exactly the fields the ingest emit puts on an `email_suggestion` event's
 * `detail`. A rule keying on anything else (`detail.category`, `detail.confidence`) is describing
 * the classifier's own output rather than the mail, which says nothing about which threads the
 * person cares about and would be circular to feed back into the classifier.
 */
const CUE_PATHS: Readonly<Record<string, RoutingCue['field']>> = {
  'detail.sender': 'sender',
  'detail.subject': 'content',
  'detail.snippet': 'content',
};

/** Whether a rule reacts to a new mail suggestion by creating work from it. */
function routesInboundMail(on: AutomationEventMatch, then: readonly ActionSpec[]): boolean {
  if (on.subjectType !== 'email_suggestion') return false;
  return then.some((action) => WORK_CREATING_ACTIONS.has(action.type));
}

/** Collect the positive sender/keyword literals a condition names, depth-first. */
function collectCues(predicate: Predicate, out: RoutingCue[]): void {
  switch (predicate.op) {
    case 'and':
    case 'or':
      for (const node of predicate.nodes) collectCues(node, out);
      return;
    case 'not':
      // Everything under a negation describes mail the rule excludes — not interest.
      return;
    case 'eq':
    case 'contains': {
      const field = CUE_PATHS[predicate.path];
      if (field === undefined) return;
      const value = String(predicate.value).trim().toLowerCase();
      if (value !== '') out.push({ field, value });
      return;
    }
    default:
      // `neq`/`gte`/`lte` name what a rule is *not* about, or compare a number. Neither
      // identifies a thread the person asked for.
      return;
  }
}

/**
 * Project one stored rule into the cues it contributes (empty when it contributes none).
 *
 * @remarks
 * Exported for direct testing: the interesting cases (a dismiss rule, a negated clause, a
 * condition on the classifier's own output) are all about what this function *declines* to
 * collect, which is easier to state here than through a whole sweep.
 *
 * @param rule - The rule's stored `on`/`when`/`then`, as the table holds them.
 */
export function ruleRoutingCues(rule: {
  on: AutomationEventMatch;
  when: Predicate;
  then: readonly ActionSpec[];
}): RoutingCue[] {
  if (!routesInboundMail(rule.on, rule.then)) return [];
  const cues: RoutingCue[] = [];
  collectCues(rule.when, cues);
  return cues;
}

/**
 * Every sender/keyword cue the org's enabled mail-routing rules name.
 *
 * @remarks
 * One query per sweep, not per thread. An org with no routing rules gets an empty list, which
 * leaves {@link classifyTaskWorthiness} behaving exactly as it did before this existed — the
 * promotional filter is only ever relaxed by a rule someone actually wrote.
 *
 * @param orgId - The workspace whose mailbox is being swept.
 */
export async function loadMailRoutingCues(orgId: string): Promise<RoutingCue[]> {
  const rows = await db
    .select({
      eventMatch: automationRule.eventMatch,
      condition: automationRule.condition,
      actions: automationRule.actions,
    })
    .from(automationRule)
    .where(
      and(
        eq(automationRule.organizationId, orgId),
        eq(automationRule.enabled, true),
        isNull(automationRule.archivedAt),
      ),
    );

  const cues: RoutingCue[] = [];
  for (const row of rows) {
    cues.push(
      ...ruleRoutingCues({
        on: row.eventMatch as AutomationEventMatch,
        when: row.condition as Predicate,
        then: row.actions as ActionSpec[],
      }),
    );
  }
  // Two rules naming the same keyword are one cue as far as matching is concerned.
  const seen = new Set<string>();
  return cues.filter((cue) => {
    const key = `${cue.field}:${cue.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
