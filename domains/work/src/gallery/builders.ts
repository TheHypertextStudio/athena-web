import type { BlueprintStep } from '../contracts/work-template-blueprint';
import { BlueprintStep as Step } from '../contracts/work-template-blueprint';
import type { ProgramDefaultSchedule } from '../contracts/work-schedule-defaults';
import { GalleryEntry, type GalleryCategory, type GalleryFork } from './types';
import { GALLERY_METADATA } from './metadata';
import { GALLERY_IDENTITIES, type GallerySlug } from './identities';
/** Authored action with a stable key, concrete checklist and optional parent-relative calendar day. */
export type GalleryAction = readonly [key: string, title: string, checklist: string, days?: number];
/** Authored catalog content; source IDs and canonical boilerplate are supplied centrally. */
export interface GalleryOutline {
  readonly slug: GallerySlug;
  readonly name?: string;
  readonly category?: GalleryCategory;
  readonly forks?: readonly GalleryFork[];
  readonly purpose: string;
  readonly kind?: 'task' | 'project' | 'program' | 'initiative';
  readonly actions?: readonly GalleryAction[];
  readonly fields?: readonly (readonly [heading: string, prompt: string])[];
  readonly steps?: readonly BlueprintStep[];
  readonly dependencies?: readonly { blockerStepKey: string; blockedStepKey: string }[];
  readonly defaultSchedules?: readonly ProgramDefaultSchedule[];
  readonly labelSuggestions?: readonly string[];
  readonly offeringSuggestions?: readonly string[];
}
/** A concrete checklist document for one authored action within its parent outcome. */
export function galleryActionDocument(title: string, purpose: string, checklist: string): string {
  return `## Goal\n${title} contributes to this outcome: ${purpose}\n\n## Checklist\n${checklist
    .split('|')
    .map((item) => `- [ ] ${item}`)
    .join(
      '\n',
    )}\n\n## Result\nLink the resulting record and note any decision or unresolved follow-up.`;
}
/** Build a strict literal child using only parent rules and an explicitly authored relative date. */
export function galleryAction(
  action: GalleryAction,
  purpose: string,
): Extract<BlueprintStep, { kind: 'task' }> {
  const [key, title, checklist, days] = action;
  return Step.options[0].parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    fields: { title, description: galleryActionDocument(title, purpose, checklist) },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
    cycleRule: 'none',
    dates:
      days === undefined
        ? {}
        : {
            dueDate: {
              kind: 'anchor',
              anchor: { kind: 'parent' },
              offset: { days, unit: 'calendar' },
            },
          },
  });
}
function galleryDocument(input: GalleryOutline, name: string): string {
  return `## Purpose\n${input.purpose}\n\n## Context\nRecord the audience, boundaries and source records for ${name.toLowerCase()}.\n\n${(input.fields ?? []).map(([heading, prompt]) => `## ${heading}\n${prompt}`).join('\n\n')}\n\n## Success\nCheck the outcome against the purpose, link the finished work, and identify any follow-up that needs its own owner.`;
}
/** Build one authored source through the current canonical definition and schedule validators. */
export function galleryOutline(input: GalleryOutline): GalleryEntry {
  const metadata = GALLERY_METADATA[input.slug];
  const name = input.name ?? metadata.name;
  const kind = input.kind ?? metadata.kind;
  const actions = (input.actions ?? []).map((action, sort) => ({
    ...galleryAction(action, input.purpose),
    sort,
  }));
  const description = galleryDocument(input, name);
  return GalleryEntry.parse({
    ...GALLERY_IDENTITIES[input.slug],
    release: 1,
    slug: input.slug,
    category: input.category ?? metadata.category,
    forks: input.forks ?? metadata.forks,
    use: input.purpose,
    definition: {
      name,
      description: input.purpose,
      payload: {
        targetType: kind,
        ...(kind === 'task' ? { title: name } : { name }),
        description,
      },
      blueprint: {
        steps: [...actions, ...(input.steps ?? [])].map((step, sort) => ({ ...step, sort })),
        dependencies: input.dependencies ?? [],
      },
    },
    defaultSchedules: input.defaultSchedules ?? [],
    labelSuggestions: input.labelSuggestions ?? [],
    offeringSuggestions: input.offeringSuggestions ?? [],
  });
}
/** Exact stable pinned reference to another first-release catalog source. */
export function galleryReference(slug: GallerySlug): NonNullable<BlueprintStep['template']> {
  const identity = GALLERY_IDENTITIES[slug];
  return Step.options[0].shape.template.unwrap().parse({
    workTypeId: identity.id,
    selection: { kind: 'pinned', workTypeVersionId: identity.versionId },
  });
}
/** Authored reusable container or composed child, without literal placement or destination ownership. */
export interface GalleryContainerOutline {
  readonly key: string;
  readonly kind: 'project' | 'program' | 'task' | 'milestone';
  readonly name: string;
  readonly purpose: string;
  readonly checklist: string;
  readonly parentStepKey?: string;
  readonly templateSlug?: GallerySlug;
  readonly days?: number;
}
/** Compose a concrete child with an exact catalog pin and optional parent-relative anchor. */
export function galleryContainer(input: GalleryContainerOutline): BlueprintStep {
  const description = galleryActionDocument(input.name, input.purpose, input.checklist);
  const field = input.kind === 'task' ? 'dueDate' : 'targetDate';
  return Step.parse({
    key: input.key,
    kind: input.kind,
    parentStepKey: input.parentStepKey ?? null,
    sort: 0,
    optional: { enabled: false, selectedByDefault: true },
    template: input.templateSlug ? galleryReference(input.templateSlug) : null,
    fields:
      input.kind === 'task'
        ? { title: input.name, description }
        : { name: input.name, description },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
    ...(input.kind === 'task' ? { cycleRule: 'none' } : {}),
    dates:
      input.days === undefined || input.kind === 'program'
        ? {}
        : {
            [field]: {
              kind: 'anchor',
              anchor: { kind: 'parent' },
              offset: { days: input.days, unit: 'calendar' },
            },
          },
  });
}
