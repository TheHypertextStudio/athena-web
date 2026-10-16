'use client';
import type { JSX } from 'react';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { EntityList, EntityListRow } from '@docket/ui/components';
import { ChevronRight } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';
import { libraryDefinition, libraryHasDraft } from './work-template-library-order';

function publicationState(item: WorkTemplateOut): string {
  if (item.status === 'archived') return 'Archived';
  if (item.latestVersion) {
    return `Published v${item.latestVersion.number}${libraryHasDraft(item) ? ' · Draft changes' : ''}`;
  }
  if (item.scope === 'team') return 'Team draft';
  return item.scope === 'personal' ? 'Private draft' : 'Unpublished draft';
}

function DefinitionRow({
  item,
  orgId,
}: {
  readonly item: WorkTemplateOut;
  readonly orgId: string;
}): JSX.Element {
  const definition = libraryDefinition(item, 'authoring');
  const kind = useVocabulary(item.targetType);
  const publishedName = item.latestVersion?.definition.name;
  return (
    <EntityListRow
      href={workTemplateHref(orgId, `/${item.id}`)}
      className="py-4"
      title={
        <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
          <span className="text-title-large break-words">{definition.name}</span>
          {definition.description ? (
            <span className="text-body-medium text-on-surface-variant line-clamp-2 break-words">
              {definition.description}
            </span>
          ) : null}
          <span className="text-body-small text-on-surface-variant mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{kind}</span>
            <span>{publicationState(item)}</span>
          </span>
          {publishedName && publishedName !== definition.name ? (
            <span className="text-body-small text-on-surface-variant break-words">
              Published as {publishedName}
            </span>
          ) : null}
        </span>
      }
      trailing={<ChevronRight aria-hidden="true" className="text-on-surface-variant size-5" />}
      render={(props) => (
        <Link
          {...props}
          href={props.href ?? workTemplateHref(orgId)}
          navigation="activity"
          id={`work-template-${item.id}`}
          aria-label={`Open ${definition.name}`}
        />
      )}
    />
  );
}

/** List each authorized definition once; reusable relationships belong inside its authoring activity. */
export function LibraryDefinitions({
  items,
  orgId,
  label = 'Work templates',
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
  readonly label?: string;
}): JSX.Element {
  const ordered = [...items].sort((a, b) =>
    libraryDefinition(a, 'authoring').name.localeCompare(libraryDefinition(b, 'authoring').name),
  );
  return (
    <EntityList aria-label={label} className="rounded-corner-lg">
      {ordered.map((item) => (
        <DefinitionRow key={item.id} item={item} orgId={orgId} />
      ))}
    </EntityList>
  );
}
