/**
 * `@docket/api` — where each top-level item of an `organize` plan was filed.
 *
 * @remarks
 * A plan's items can hang off something that already exists — nine tasks filed into an existing
 * project — and the placement resolves that project before it writes a row. The result used to drop
 * it, so a report could say what was created but not where it went, which is the first thing a
 * person checks. This names the existing container each top-level item was filed into.
 */
import { db, initiative, program, project } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { KINDS, type ItemRefs, type Placed } from '../lib/organize/place';
import { entityHref } from './entity-href';

/** The existing project, program, or initiative a top-level item was filed into. */
export interface PlacedContainer {
  readonly kind: 'project' | 'program' | 'initiative';
  readonly id: string;
  readonly title: string;
  readonly href: string;
}

/** One placed item, with its container when it was filed into an existing one. */
export type PlacedWithContainer = Placed & { readonly container?: PlacedContainer };

/** The `placed` entry of `organize`'s output schema. */
export const placedOutputSchema = z.object({
  ref: z.string().describe('The handle you gave it.'),
  kind: z.enum(KINDS),
  id: z.string().describe('Its real id.'),
  title: z.string().describe('What it is called.'),
  href: z.string().describe('Where it lives in the product app.'),
  parent: z
    .string()
    .optional()
    .describe('The `ref` of the item in this call it was placed under, when any.'),
  container: z
    .object({
      kind: z.enum(['project', 'program', 'initiative']),
      id: z.string(),
      title: z.string(),
      href: z.string(),
    })
    .optional()
    .describe('The existing project, program, or initiative a top-level item was filed into.'),
  created: z.boolean().describe('False when an existing item of that name was matched instead.'),
  projectId: z.string().optional().describe('For a milestone, the project it is in.'),
});

type ContainerKind = PlacedContainer['kind'];

/** The most specific existing container an item was filed into, as kind and id. */
function containerOf(kind: Placed['kind'], refs: ItemRefs): [ContainerKind, string] | null {
  const order: readonly [ContainerKind, string | null][] =
    kind === 'task' || kind === 'milestone'
      ? [
          ['project', refs.projectId],
          ['program', refs.programId],
        ]
      : [
          ['program', kind === 'project' ? refs.programId : null],
          ['initiative', refs.initiativeId],
        ];
  const found = order.find(([, id]) => id !== null);
  return found?.[1] ? [found[0], found[1]] : null;
}

/** The names of the given containers, keyed `kind:id`. */
async function containerNames(
  orgId: string,
  wanted: readonly [ContainerKind, string][],
): Promise<Map<string, string>> {
  const ids = (kind: ContainerKind): string[] => [
    ...new Set(wanted.filter(([k]) => k === kind).map(([, id]) => id)),
  ];
  const [projects, programs, initiatives] = await Promise.all([
    ids('project').length > 0
      ? db
          .select({ id: project.id, name: project.name })
          .from(project)
          .where(and(eq(project.organizationId, orgId), inArray(project.id, ids('project'))))
      : [],
    ids('program').length > 0
      ? db
          .select({ id: program.id, name: program.name })
          .from(program)
          .where(and(eq(program.organizationId, orgId), inArray(program.id, ids('program'))))
      : [],
    ids('initiative').length > 0
      ? db
          .select({ id: initiative.id, name: initiative.name })
          .from(initiative)
          .where(
            and(eq(initiative.organizationId, orgId), inArray(initiative.id, ids('initiative'))),
          )
      : [],
  ]);
  const names = new Map<string, string>();
  for (const row of projects) names.set(`project:${row.id}`, row.name);
  for (const row of programs) names.set(`program:${row.id}`, row.name);
  for (const row of initiatives) names.set(`initiative:${row.id}`, row.name);
  return names;
}

/**
 * Add each top-level item's existing container to the placement report.
 *
 * @param orgId - The organization the plan was filed in.
 * @param placed - What `organize` placed, in order.
 * @param refs - The resolved references of each item, by the item's `ref`.
 * @returns The same placements; top-level items filed into an existing container name it.
 */
export async function placedWithContainers(
  orgId: string,
  placed: readonly Placed[],
  refs: ReadonlyMap<string, ItemRefs>,
): Promise<PlacedWithContainer[]> {
  const targets = new Map<string, [ContainerKind, string]>();
  for (const row of placed) {
    const itemRefs = refs.get(row.ref);
    const target = row.parent === undefined && itemRefs ? containerOf(row.kind, itemRefs) : null;
    if (target) targets.set(row.ref, target);
  }
  if (targets.size === 0) return [...placed];
  const names = await containerNames(orgId, [...targets.values()]);
  return placed.map((row) => {
    const target = targets.get(row.ref);
    const title = target ? names.get(`${target[0]}:${target[1]}`) : undefined;
    if (!target || title === undefined) return row;
    const [kind, id] = target;
    return { ...row, container: { kind, id, title, href: entityHref(orgId, kind, id) } };
  });
}
