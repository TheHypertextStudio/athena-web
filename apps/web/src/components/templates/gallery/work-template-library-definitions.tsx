'use client';
import type { JSX } from 'react';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Text,
} from '@docket/ui/primitives';
import { ArrowRight, ChevronRight } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import Link from '@/components/docket-link';
import { blueprintOutlineNodes, blueprintStepName } from '../work-template-blueprint-edit';
import { workTemplateHref } from '../work-template-navigation';
import {
  libraryDefinition,
  libraryWorkOrder,
  type LibraryWorkRow,
  type LibraryWorkView,
} from './work-template-library-order';

interface DefinitionGroup {
  readonly root: WorkTemplateOut;
  readonly related: readonly LibraryWorkRow[];
}
function definitionGroups(
  items: readonly WorkTemplateOut[],
  view: LibraryWorkView,
): DefinitionGroup[] {
  const ordered = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups: { root: WorkTemplateOut; related: LibraryWorkRow[] }[] = [];
  for (const row of libraryWorkOrder(ordered, view)) {
    if (row.depth === 0) groups.push({ root: row.item, related: [] });
    else groups.at(-1)?.related.push(row);
  }
  return groups.sort(
    (a, b) =>
      Number(
        b.related.some((row) => row.item.latestVersion === null && row.item.pendingPublication),
      ) -
      Number(
        a.related.some((row) => row.item.latestVersion === null && row.item.pendingPublication),
      ),
  );
}
function DefinitionShape({
  item,
  view,
}: {
  readonly item: WorkTemplateOut;
  readonly view: LibraryWorkView;
}): JSX.Element {
  const definition = libraryDefinition(item, view),
    noun = useVocabulary(item.targetType).toLocaleLowerCase();
  const nodes = blueprintOutlineNodes(definition.blueprint);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-body-small text-on-surface-variant">
        {noun.charAt(0).toUpperCase() + noun.slice(1)} definition
      </p>
      {nodes.length ? (
        <div>
          <p className="text-label-large">Includes</p>
          <p className="text-body-medium break-words">
            {nodes
              .slice(0, 3)
              .map((node) => blueprintStepName(node.step))
              .join(' · ')}
            {nodes.length > 3 ? ` · ${nodes.length - 3} more` : ''}
          </p>
        </div>
      ) : (
        <p className="text-body-medium text-on-surface-variant">Defines the starting {noun}.</p>
      )}
      {definition.defaultSchedules.length ? (
        <div>
          <p className="text-label-large">Recurring work</p>
          <p className="text-body-medium break-words">
            {definition.defaultSchedules.map((schedule) => schedule.name).join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
function RelatedDefinitions({
  rows,
  orgId,
  parentId,
}: {
  readonly rows: readonly LibraryWorkRow[];
  readonly orgId: string;
  readonly parentId: string;
}): JSX.Element | null {
  if (!rows.length) return null;
  return (
    <section aria-label="Related definitions" className="flex min-w-0 flex-col gap-3">
      <p className="text-label-large">Included and recurring definitions</p>
      <ul className="flex min-w-0 flex-col gap-4">
        {rows.map((row) => (
          <li key={row.key} className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                className="text-primary text-title-medium break-words underline-offset-4 hover:underline"
                href={`${workTemplateHref(orgId)}/${row.item.id}`}
              >
                {libraryDefinition(row.item, 'authoring').name}
              </Link>
              <p className="text-body-small text-on-surface-variant">
                {row.relationship}
                {row.item.scope === 'team' ? ' · Team draft' : ''}
              </p>
            </div>
            {row.item.latestVersion === null && row.item.pendingPublication ? (
              <Button
                asChild
                variant="secondary"
                className="coarse:h-auto h-auto min-h-10 max-w-full py-2 whitespace-normal"
              >
                <Link
                  href={`${workTemplateHref(orgId)}/${row.item.id}?section=review&returnTo=${parentId}`}
                >
                  Review {libraryDefinition(row.item, 'authoring').name}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
function PublishedVersion({ item }: { readonly item: WorkTemplateOut }): JSX.Element | null {
  if (!item.latestVersion) return null;
  const definition = item.latestVersion.definition;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-10"
          aria-label={`View published version of ${item.definition.name}`}
        >
          View published version {item.latestVersion.number}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <p className="text-title-medium">{definition.name}</p>
        {definition.description ? (
          <p className="text-body-medium text-on-surface-variant">{definition.description}</p>
        ) : null}
        <p className="text-body-small text-on-surface-variant">
          New work can still use this publication. Publishing your changes creates a new version.
        </p>
        <DefinitionShape item={item} view="published" />
      </CollapsibleContent>
    </Collapsible>
  );
}
function DraftDefinition({
  group,
  orgId,
  primary,
}: {
  readonly group: DefinitionGroup;
  readonly orgId: string;
  readonly primary: boolean;
}): JSX.Element {
  const { root: item, related } = group,
    definition = libraryDefinition(item, 'authoring');
  const prerequisites = related.filter(
    (row) => row.item.latestVersion === null && row.item.pendingPublication,
  );
  return (
    <article
      aria-label={definition.name}
      className="flex min-w-0 flex-col gap-5 py-6 first:pt-0 last:pb-0"
    >
      <div className="grid min-w-0 items-start gap-4 @2xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <Text as="h3" token="headline-small">
            {definition.name}
          </Text>
          {definition.description ? (
            <p className="text-body-large text-on-surface-variant max-w-prose break-words">
              {definition.description}
            </p>
          ) : null}
          <p className="text-label-large">
            {item.latestVersion
              ? `Unpublished changes · Version ${item.latestVersion.number} stays available`
              : item.scope === 'team'
                ? 'Team draft · Not published'
                : 'Private draft · Not published'}
          </p>
        </div>
        <Button
          asChild
          variant={primary ? 'default' : 'secondary'}
          className="coarse:h-auto h-auto min-h-10 max-w-full justify-self-start py-2 text-left whitespace-normal"
        >
          <Link href={`${workTemplateHref(orgId)}/${item.id}`}>
            {item.canEdit ? 'Continue defining' : 'Review'} {definition.name}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
      <DefinitionShape item={item} view="authoring" />
      {prerequisites.length ? (
        <p className="text-body-medium">
          Before publishing {definition.name}, review{' '}
          {prerequisites.map((row) => libraryDefinition(row.item, 'authoring').name).join(' and ')}.
        </p>
      ) : null}
      <RelatedDefinitions rows={related} orgId={orgId} parentId={item.id} />
      {item.latestVersion ? <PublishedVersion item={item} /> : null}
    </article>
  );
}
function DraftOwnership({
  title,
  groups,
  orgId,
}: {
  title: string;
  groups: readonly DefinitionGroup[];
  orgId: string;
}): JSX.Element | null {
  if (!groups.length) return null;
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4">
      <p className="text-label-large text-on-surface-variant">{title}</p>
      <div className="divide-outline-variant divide-y">
        {groups.map((group, index) => (
          <DraftDefinition key={group.root.id} group={group} orgId={orgId} primary={index === 0} />
        ))}
      </div>
    </section>
  );
}
/** Group the complete authorized draft graph before assigning its roots to ownership sections. */
export function LibraryDraftDefinitions({
  items,
  orgId,
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element {
  const groups = definitionGroups(items, 'authoring');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DraftOwnership
        title="Your drafts"
        groups={groups.filter((group) => group.root.scope !== 'team')}
        orgId={orgId}
      />
      <DraftOwnership
        title="Team drafts"
        groups={groups.filter((group) => group.root.scope === 'team')}
        orgId={orgId}
      />
    </div>
  );
}
/** Read publication facts without presenting their draft edits as the published starting work. */
export function LibraryPublishedDefinitions({
  items,
  orgId,
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element {
  return (
    <div className="divide-outline-variant divide-y">
      {libraryWorkOrder(items, 'published').map((row) => {
        const item = row.item,
          definition = libraryDefinition(item, 'published');
        return (
          <article
            key={row.key}
            className={`flex min-w-0 flex-col gap-2 py-5 first:pt-0 last:pb-0 ${row.depth ? 'ml-4' : ''}`}
          >
            <Text as="h3" token="title-large">
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={`${workTemplateHref(orgId)}/${item.id}`}
              >
                {definition.name}
                <ChevronRight aria-hidden="true" className="ml-1 inline size-4" />
              </Link>
            </Text>
            {row.relationship ? (
              <p className="text-body-small text-on-surface-variant">{row.relationship}</p>
            ) : null}
            {definition.description ? (
              <p className="text-body-medium text-on-surface-variant">{definition.description}</p>
            ) : null}
            <DefinitionShape item={item} view="published" />
            {item.latestVersion ? (
              <p className="text-body-small text-on-surface-variant">
                Version {item.latestVersion.number} · Available when creating work
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
