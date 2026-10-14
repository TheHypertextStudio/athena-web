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
 * {@link seedDefaultTemplates} installs defaults on the first list read of an empty workspace.
 * An existing template prevents reseeding, so updates to this catalog do not overwrite workspace
 * templates. Removing every template makes the workspace empty and seeds defaults on its next read.
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
 * Short editable outlines cover individual, client, team, business, and nonprofit work. These
 * examples do not define product types or restrict what a workspace may create. Examples do not
 * preassign urgency or a health rating.
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    targetType: 'task',
    name: 'Fix a problem',
    description: 'Describe what is wrong and what needs to change.',
    payload: {
      targetType: 'task',
      description: ['## Problem', '', '## How to check it', '', '## Done when'].join('\n'),
      priority: 'none',
    },
  },
  {
    targetType: 'task',
    name: 'Make a decision',
    description: 'Compare your options and choose what to do next.',
    payload: {
      targetType: 'task',
      description: ['## Question', '', '## Options', '', '## Decision'].join('\n'),
      priority: 'none',
    },
  },
  {
    targetType: 'task',
    name: 'Meeting follow-up',
    description: 'Keep track of decisions and what needs doing after a meeting.',
    payload: {
      targetType: 'task',
      description: ['## What we decided', '', '## Next steps'].join('\n'),
      priority: 'none',
    },
  },
  {
    targetType: 'project',
    name: 'Side project',
    description: 'Plan something you want to make or try.',
    payload: {
      targetType: 'project',
      description: ['## Idea', '', '## Next steps', '', '## Finished when'].join('\n'),
      status: 'planned',
    },
  },
  {
    targetType: 'project',
    name: 'Client project',
    description: 'Agree on the work, deadline, and deliverables.',
    payload: {
      targetType: 'project',
      description: ['## Brief', '', '## Deliverables', '', '## Schedule', '', '## Budget'].join(
        '\n',
      ),
      status: 'planned',
    },
  },
  {
    targetType: 'project',
    name: 'Launch',
    description: 'Prepare something for release and keep track of what remains.',
    payload: {
      targetType: 'project',
      description: [
        '## What we are launching',
        '',
        '## Before launch',
        '',
        '## Launch day',
        '',
        '## Follow-up',
      ].join('\n'),
      status: 'planned',
    },
  },
  {
    targetType: 'initiative',
    name: 'Long-term goal',
    description: 'Organize the projects and progress toward a goal.',
    payload: {
      targetType: 'initiative',
      description: ['## Goal', '', '## Why it matters', '', '## Projects', '', '## Progress'].join(
        '\n',
      ),
      status: 'proposed',
      priority: 'none',
      updateCadence: 'monthly',
    },
  },
  {
    targetType: 'initiative',
    name: 'Fundraising campaign',
    description: 'Plan who to reach, what to raise, and how to follow up.',
    payload: {
      targetType: 'initiative',
      description: [
        '## Goal',
        '',
        '## People to contact',
        '',
        '## Projects',
        '',
        '## Progress',
      ].join('\n'),
      status: 'proposed',
      priority: 'none',
      updateCadence: 'monthly',
    },
  },
  {
    targetType: 'initiative',
    name: 'Try an idea',
    description: 'Test an idea before committing more time or money.',
    payload: {
      targetType: 'initiative',
      description: [
        '## Idea',
        '',
        '## What to try',
        '',
        '## What we learned',
        '',
        '## Decision',
      ].join('\n'),
      status: 'proposed',
      priority: 'none',
      updateCadence: 'monthly',
    },
  },
  {
    targetType: 'program',
    name: 'Running a business',
    description: 'Keep the ongoing work of a business in one place.',
    payload: {
      targetType: 'program',
      description: [
        '## Responsibilities',
        '',
        '## Regular work',
        '',
        '## Current projects',
        '',
        '## People',
      ].join('\n'),
      status: 'active',
    },
  },
  {
    targetType: 'program',
    name: 'Community group',
    description: 'Organize the ongoing work of a group or nonprofit.',
    payload: {
      targetType: 'program',
      description: ['## Purpose', '', '## Regular work', '', '## Projects', '', '## People'].join(
        '\n',
      ),
      status: 'active',
    },
  },
  {
    targetType: 'program',
    name: 'Personal routines',
    description: 'Keep your routines, responsibilities, and related projects together.',
    payload: {
      targetType: 'program',
      description: ['## Routines', '', '## Responsibilities', '', '## Projects'].join('\n'),
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
