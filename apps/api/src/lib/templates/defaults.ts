/**
 * `@docket/api` — the shipped default templates, and the per-org seed that installs them.
 *
 * @remarks
 * Docket ships three templates for each of the four templatable kinds. They are seeded as
 * ordinary `is_seed` rows — DATA, not code branches — so a workspace may rename, rewrite, or
 * delete any of them and the product does not argue. This mirrors
 * `../automation/rules-store.ts`, which makes the same choice for the default automation rules
 * and for the same reason: a default a user cannot edit is not a default, it is a rule.
 *
 * Three per kind is the whole opinion. A picker with twelve entries for one kind is a filing
 * cabinet; a picker with three is a suggestion. Users add their own beyond that without limit.
 *
 * Seeding is lazy — {@link seedDefaultTemplates} runs on the first list read rather than at org
 * bootstrap or in a migration, which is how `seedDefaultAutomationRules` is already wired
 * (`routes/integrations.ts`, `lib/email-to-task/sweep.ts`). One consequence is worth stating:
 * because the guard is "does this org have any template row at all", a workspace that deletes
 * every shipped default keeps it deleted. That is the intended reading of "editable".
 */
import { db, template } from '@docket/db';
import type { TemplateDraft, TemplateTargetType } from '@docket/work/template-contract';
import { eq } from 'drizzle-orm';

/** One shipped default template (seeded per org as an editable `isSeed` row). */
export interface DefaultTemplate {
  /** The kind it creates. Always equal to `payload.targetType`. */
  readonly targetType: TemplateTargetType;
  /** The name shown verbatim in the picker. */
  readonly name: string;
  /** One line on when to reach for it, shown under the name. */
  readonly description: string;
  /** The draft it applies. */
  readonly payload: TemplateDraft;
}

/**
 * The shipped default template set — DATA, not code.
 *
 * @remarks
 * Every body is a heading outline rather than prose. A template that supplies sentences invites
 * the author to edit around them; a template that supplies questions makes the blank page the
 * author's own. The outlines are deliberately short — four or five headings — because an outline
 * long enough to scroll is a form, and nobody fills in a form voluntarily.
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  // — Tasks ————————————————————————————————————————————————————————————————
  {
    targetType: 'task',
    name: 'Bug report',
    description: 'Something is broken and someone needs to reproduce it before fixing it.',
    payload: {
      targetType: 'task',
      description: [
        '## Steps to reproduce',
        '',
        '1. ',
        '',
        '## What should happen',
        '',
        '## What happens instead',
        '',
        '## Who this affects',
      ].join('\n'),
      priority: 'high',
    },
  },
  {
    targetType: 'task',
    name: 'Research spike',
    description: 'A timeboxed investigation that ends in a decision, not in code.',
    payload: {
      targetType: 'task',
      description: ['## Question', '', '## Timebox', '', '## What we will decide at the end'].join(
        '\n',
      ),
      priority: 'medium',
    },
  },
  {
    targetType: 'task',
    name: 'Meeting follow-up',
    description: 'Capture what a meeting decided while it is still fresh.',
    payload: {
      targetType: 'task',
      description: ['## Decisions', '', '## Owners', '', '## Deadlines'].join('\n'),
      priority: 'none',
    },
  },

  // — Projects —————————————————————————————————————————————————————————————
  {
    targetType: 'project',
    name: 'Product launch',
    description: 'Ship something to customers on a date, with a go/no-go before it goes.',
    payload: {
      targetType: 'project',
      description: [
        '## Goal',
        '',
        '## In scope',
        '',
        '## Explicitly not in scope',
        '',
        '## Launch checklist',
        '',
        '## Risks',
        '',
        '## Go / no-go criteria',
      ].join('\n'),
      status: 'planned',
      health: 'on_track',
    },
  },
  {
    targetType: 'project',
    name: 'Research spike',
    description: 'A larger investigation with a method and a named decision-maker.',
    payload: {
      targetType: 'project',
      description: [
        '## Question',
        '',
        '## Method',
        '',
        '## Timebox',
        '',
        '## Who decides, and on what',
      ].join('\n'),
      status: 'planned',
    },
  },
  {
    targetType: 'project',
    name: 'Process rollout',
    description: 'Change how a group works, and know afterwards whether it took.',
    payload: {
      targetType: 'project',
      description: [
        '## What changes',
        '',
        '## Who is affected',
        '',
        '## Rollout stages',
        '',
        '## How we measure adoption',
      ].join('\n'),
      status: 'planned',
    },
  },

  // — Initiatives ——————————————————————————————————————————————————————————
  {
    targetType: 'initiative',
    name: 'Strategic initiative',
    description: 'A theme with a direction, a rationale, and a way to tell if it worked.',
    payload: {
      targetType: 'initiative',
      description: [
        '## Overview',
        '',
        '## Motivation and purpose',
        '',
        '## Desired outcome',
        '',
        '## Approach',
        '',
        '## How we will measure it',
      ].join('\n'),
      status: 'active',
      priority: 'medium',
      updateCadence: 'monthly',
    },
  },
  {
    targetType: 'initiative',
    name: 'Objective',
    description: 'A measurable target with key results and a tight review cadence.',
    payload: {
      targetType: 'initiative',
      description: [
        '## Objective',
        '',
        '## Key results',
        '',
        '1. ',
        '2. ',
        '3. ',
        '',
        '## Who owns it, and when we review',
        '',
        '## Explicitly out of scope',
      ].join('\n'),
      status: 'active',
      priority: 'high',
      updateCadence: 'weekly',
    },
  },
  {
    targetType: 'initiative',
    name: 'Bet',
    description: 'A falsifiable wager with a decision date and a stated cost of being wrong.',
    payload: {
      targetType: 'initiative',
      description: [
        '## Hypothesis',
        '',
        '## What we believe, and why',
        '',
        '## What would prove us wrong',
        '',
        '## Time and money at risk',
        '',
        '## Decision date',
      ].join('\n'),
      status: 'proposed',
      priority: 'medium',
      updateCadence: 'biweekly',
    },
  },

  // — Programs —————————————————————————————————————————————————————————————
  {
    targetType: 'program',
    name: 'Operating cadence',
    description: 'A standing rhythm of rituals with named owners and review points.',
    payload: {
      targetType: 'program',
      description: [
        '## Purpose',
        '',
        '## Rituals, and who runs each',
        '',
        '## Review points',
        '',
        '## What good looks like',
      ].join('\n'),
      status: 'active',
    },
  },
  {
    targetType: 'program',
    name: 'Support function',
    description: 'Ongoing work that answers requests rather than finishing a scope.',
    payload: {
      targetType: 'program',
      description: [
        '## What this function covers',
        '',
        '## How work arrives, and how it is triaged',
        '',
        '## What people can expect from us',
        '',
        '## Escalation',
      ].join('\n'),
      status: 'active',
    },
  },
  {
    targetType: 'program',
    name: 'Ongoing platform work',
    description: 'The maintenance that never completes, made visible instead of invisible.',
    payload: {
      targetType: 'program',
      description: [
        '## What we maintain',
        '',
        '## Recurring commitments',
        '',
        '## Health signals we watch',
      ].join('\n'),
      status: 'active',
    },
  },
];

/**
 * Seed the shipped default templates for an org, once.
 *
 * @remarks
 * Idempotent: if the org already holds any template row — shipped or authored — this is a no-op,
 * so it is safe on every list read. Seeded rows are `organization`-scoped and ownerless, because
 * a shipped default belongs to the workspace rather than to whoever happened to open the picker
 * first.
 *
 * @param orgId - The org to seed.
 * @param actorId - The actor recorded as `createdBy`.
 * @returns how many rows it created.
 */
export async function seedDefaultTemplates(orgId: string, actorId: string | null): Promise<number> {
  const existing = await db
    .select({ id: template.id })
    .from(template)
    .where(eq(template.organizationId, orgId))
    .limit(1);
  if (existing.length > 0) return 0;

  await db.insert(template).values(
    DEFAULT_TEMPLATES.map((t) => ({
      organizationId: orgId,
      createdBy: actorId,
      targetType: t.targetType,
      name: t.name,
      description: t.description,
      scope: 'organization' as const,
      payload: t.payload,
      isSeed: true,
    })),
  );
  return DEFAULT_TEMPLATES.length;
}
