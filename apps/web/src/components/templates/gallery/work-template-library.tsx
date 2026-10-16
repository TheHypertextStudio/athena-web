'use client';
import { useState, type JSX } from 'react';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ControlGroup,
  Field,
  Input,
  Select,
  Surface,
  Text,
} from '@docket/ui/primitives';
import { ChevronRight } from '@docket/ui/icons';
import {
  libraryDefinition,
  libraryHasDraft,
  libraryWorkOrder,
  type LibraryWorkView,
} from './work-template-library-order';
import { useVocabulary } from '@docket/ui/hooks';
import { SettingRow } from '@/components/settings/setting-row';
import { sectionHref } from '@/components/settings/settings-registry';

const kinds = ['initiative', 'program', 'project', 'task'] as const;
function WorkDefinitionRows({
  items,
  orgId,
  view,
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
  readonly view: LibraryWorkView;
}): JSX.Element {
  return (
    <>
      {libraryWorkOrder(items, view).map((row) => (
        <div key={row.key} className={row.depth ? 'ml-4' : ''}>
          <WorkDefinitionRow
            item={row.item}
            orgId={orgId}
            view={view}
            relationship={row.relationship}
          />
        </div>
      ))}
    </>
  );
}
function WorkDefinitionRow({
  item,
  orgId,
  view,
  relationship,
}: {
  readonly item: WorkTemplateOut;
  readonly orgId: string;
  readonly view: LibraryWorkView;
  readonly relationship: string | null;
}): JSX.Element {
  const noun = useVocabulary(item.targetType),
    definition = libraryDefinition(item, view);
  return (
    <SettingRow
      href={`${sectionHref(orgId, 'templates')}/${item.id}`}
      label={definition.name}
      description={[
        relationship,
        noun,
        view === 'authoring' && item.status === 'published' ? 'Unpublished edits' : '',
        view === 'published' && item.latestVersion ? `Version ${item.latestVersion.number}` : '',
        definition.description,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={<ChevronRight aria-hidden="true" className="text-on-surface-variant size-4" />}
    />
  );
}
function LibraryGroup({
  title,
  items,
  orgId,
  empty,
}: {
  readonly title: string;
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
  readonly empty?: string;
}): JSX.Element | null {
  if (!items.length && !empty) return null;
  return (
    <Surface as="section" shape="large" pad="none" aria-label={title}>
      <Text as="h2" token="title-large" className="px-4 pt-4 pb-2">
        {title}
      </Text>
      {items.length ? (
        <WorkDefinitionRows items={items} orgId={orgId} view="published" />
      ) : (
        <p className="text-body-medium text-on-surface-variant p-4">{empty}</p>
      )}
    </Surface>
  );
}
function DraftOwnership({
  title,
  items,
  orgId,
}: {
  readonly title: string;
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element | null {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <Text as="h3" token="title-medium" className="px-4 pt-3">
        {title}
      </Text>
      <WorkDefinitionRows items={items} orgId={orgId} view="authoring" />
    </section>
  );
}
function ContinueDefining({
  drafts,
  orgId,
}: {
  readonly drafts: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element | null {
  if (!drafts.length) return null;
  return (
    <Surface as="section" shape="large" pad="none" aria-label="Continue defining">
      <Text as="h2" token="title-large" className="px-4 pt-4">
        Continue defining
      </Text>
      <DraftOwnership
        title="Your drafts"
        orgId={orgId}
        items={drafts.filter((item) => item.scope !== 'team')}
      />
      <DraftOwnership
        title="Team drafts"
        orgId={orgId}
        items={drafts.filter((item) => item.scope === 'team')}
      />
    </Surface>
  );
}
function LibraryKindFilter({
  kind,
  onKind,
}: {
  readonly kind: TemplateTargetType | '';
  readonly onKind: (kind: TemplateTargetType | '') => void;
}): JSX.Element {
  const labels = [
    useVocabulary('initiative'),
    useVocabulary('program'),
    useVocabulary('project'),
    useVocabulary('task'),
  ];
  return (
    <Field label="Work kind">
      <Select
        value={kind}
        onChange={(event) => {
          onKind(kinds.find((value) => value === event.target.value) ?? '');
        }}
      >
        <option value="">All kinds</option>
        {kinds.map((value, index) => (
          <option key={value} value={value}>
            {labels[index]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function LibrarySearch({
  search,
  kind,
  setSearch,
  setKind,
}: {
  readonly search: string;
  readonly kind: TemplateTargetType | '';
  readonly setSearch: (search: string) => void;
  readonly setKind: (kind: TemplateTargetType | '') => void;
}): JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">Find a work definition</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 py-3 sm:grid-cols-2">
        <Field label="Search work definitions">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </Field>
        <LibraryKindFilter kind={kind} onKind={setKind} />
      </CollapsibleContent>
    </Collapsible>
  );
}
function LibraryManagement({
  title,
  expandedTitle,
  items,
  orgId,
}: {
  readonly title: string;
  readonly expandedTitle: string;
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element | null {
  if (!items.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">
          {title} ({items.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LibraryGroup title={expandedTitle} orgId={orgId} items={items} />
      </CollapsibleContent>
    </Collapsible>
  );
}
/** Organize authorized workspace definitions by readiness before kind, keeping defaults subordinate. */
export function WorkTemplateLibrary({
  items,
  orgId,
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element {
  const [search, setSearch] = useState(''),
    [kind, setKind] = useState<TemplateTargetType | ''>('');
  const visible = items.filter(
    (item) =>
      (!kind || item.targetType === kind) &&
      `${item.definition.name} ${item.definition.description ?? ''} ${item.draftDefinition?.name ?? ''} ${item.draftDefinition?.description ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const ready = visible.filter((item) => item.status === 'published' && !item.isBase);
  const drafts = visible.filter(libraryHasDraft);
  const defaults = visible.filter((item) => item.isBase && item.status !== 'archived');
  const archived = visible.filter((item) => item.status === 'archived');
  return (
    <ControlGroup controlSize="xl" orientation="vertical" className="gap-5">
      <ContinueDefining drafts={drafts} orgId={orgId} />
      <LibrarySearch search={search} kind={kind} setSearch={setSearch} setKind={setKind} />
      {search || kind ? (
        <p className="text-body-small text-on-surface-variant">
          {visible.length} matching definitions{' '}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
            onClick={() => {
              setSearch('');
              setKind('');
            }}
          >
            Clear filters
          </Button>
        </p>
      ) : null}
      <LibraryGroup
        title="Ready to use"
        orgId={orgId}
        items={ready}
        empty={
          search || kind
            ? 'No published definitions match these filters.'
            : 'Define the work your workspace repeats, or choose starting work from the gallery.'
        }
      />
      <LibraryManagement
        title="Defaults"
        expandedTitle="Default work"
        items={defaults}
        orgId={orgId}
      />
      <LibraryManagement
        title="Archived"
        expandedTitle="Archived definitions"
        items={archived}
        orgId={orgId}
      />
    </ControlGroup>
  );
}
