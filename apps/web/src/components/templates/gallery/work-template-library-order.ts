import type { WorkTemplateOut, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { blueprintOutlineNodes } from '../work-template-blueprint-edit';
import { authoredCopyReferences, copyFacts } from '@docket/work/template-copy';
import { pendingTemplateReference } from '../work-template-pending-reference';

type Reference = ReturnType<typeof authoredCopyReferences>[number];
/** Authoring uses an authorized current draft; ready work always describes its actual publication. */
export type LibraryWorkView = 'authoring' | 'published';
/** A visible current relationship; shared definitions can have several links, never exclusive ownership. */
export interface LibraryWorkRow {
  readonly key: string;
  readonly item: WorkTemplateOut;
  readonly depth: number;
  readonly relationship: string | null;
}
/** Choose current editor facts or published facts explicitly, without mixing their edges or names. */
export function libraryDefinition(
  item: WorkTemplateOut,
  view: LibraryWorkView,
): WorkTemplateDefinition {
  return view === 'authoring' ? (item.draftDefinition ?? item.definition) : item.definition;
}
function resolves(reference: Reference, parent: WorkTemplateOut, child: WorkTemplateOut): boolean {
  if (
    parent.id === child.id ||
    parent.organizationId !== child.organizationId ||
    reference.kind !== child.targetType
  )
    return false;
  if (child.status === 'archived') return false;
  if (pendingTemplateReference(reference.reference, child)) return true;
  if (!child.latestVersion) return false;
  return (
    reference.reference.selection.kind === 'latest' ||
    reference.reference.selection.workTypeVersionId === child.latestVersion.id
  );
}
function relationship(
  parent: WorkTemplateOut,
  reference: Reference,
  view: LibraryWorkView,
): string {
  const definition = libraryDefinition(parent, view);
  if (reference.slot.kind === 'default_schedule') return `Recurring for ${definition.name}`;
  const step = definition.blueprint.steps.find((item) => item.key === reference.slot.key);
  return `${step?.optional.enabled ? 'Included in' : 'Needed by'} ${definition.name}`;
}
function orderedReferences(definition: WorkTemplateDefinition): readonly Reference[] {
  const references = authoredCopyReferences({ definition });
  const byKey = new Map(
    references
      .filter((reference) => reference.slot.kind === 'blueprint_step')
      .map((reference) => [reference.slot.key, reference]),
  );
  function visit(node: ReturnType<typeof blueprintOutlineNodes>[number]): Reference[] {
    const reference = byKey.get(node.step.key);
    return [...(reference ? [reference] : []), ...node.children.flatMap(visit)];
  }
  return [
    ...blueprintOutlineNodes(definition.blueprint).flatMap(visit),
    ...references.filter((reference) => reference.slot.kind === 'default_schedule'),
  ];
}
/** Detect actual editable unpublished changes without treating object-key order as an edit. */
export function libraryHasDraft(item: WorkTemplateOut): boolean {
  if (item.status === 'archived' || item.isBase) return false;
  if (item.status === 'draft') return true;
  return (
    item.canEdit &&
    Boolean(
      item.draftDefinition &&
      copyFacts(item.draftDefinition) !==
        copyFacts(item.latestVersion?.definition ?? item.definition),
    )
  );
}
function currentChildren(
  parent: WorkTemplateOut,
  items: readonly WorkTemplateOut[],
  view: LibraryWorkView,
) {
  const children = orderedReferences(libraryDefinition(parent, view)).flatMap((reference) => {
    const child = items.find((item) => item.id === reference.reference.workTypeId);
    return child && resolves(reference, parent, child)
      ? [{ item: child, relationship: relationship(parent, reference, view) }]
      : [];
  });
  const unique = new Map<string, (typeof children)[number]>();
  for (const child of children) {
    if (!unique.has(child.item.id) || child.relationship.startsWith('Needed by '))
      unique.set(child.item.id, child);
  }
  return [...unique.values()];
}
/** Order exact current relationships; keep shared aliases, unresolved work and cyclic drafts reachable. */
export function libraryWorkOrder(
  items: readonly WorkTemplateOut[],
  view: LibraryWorkView,
): readonly LibraryWorkRow[] {
  const children = new Map(items.map((item) => [item.id, currentChildren(item, items, view)]));
  const referenced = new Set(
    [...children.values()].flatMap((values) => values.map((value) => value.item.id)),
  );
  const expanded = new Set<string>(),
    rows: LibraryWorkRow[] = [];
  function append(
    item: WorkTemplateOut,
    depth: number,
    relation: string | null,
    owner: string,
  ): void {
    rows.push({
      key: `${owner}/${item.id}`,
      item,
      depth: Math.min(depth, 2),
      relationship: relation,
    });
    if (expanded.has(item.id)) return;
    expanded.add(item.id);
    for (const child of children.get(item.id) ?? [])
      append(child.item, depth + 1, child.relationship, item.id);
  }
  items
    .filter((item) => !referenced.has(item.id))
    .forEach((item) => {
      append(item, 0, null, 'root');
    });
  // No-root cycles still retain a real editor entry; each target's descendants expand at most once.
  items
    .filter((item) => !expanded.has(item.id))
    .forEach((item) => {
      append(item, 0, null, 'root');
    });
  return rows;
}
