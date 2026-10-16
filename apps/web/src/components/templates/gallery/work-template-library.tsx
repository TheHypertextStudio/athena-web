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
import { libraryHasDraft } from './work-template-library-order';
import {
  LibraryDraftDefinitions,
  LibraryPublishedDefinitions,
} from './work-template-library-definitions';
import { LibraryDefineEntry } from './work-template-library-entry';
import { useVocabulary } from '@docket/ui/hooks';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';

const kinds = ['initiative', 'program', 'project', 'task'] as const;
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
    <Surface as="section" shape="large" pad="roomy" aria-label={title}>
      <Text as="h2" token="title-large" className="mb-5">
        {title}
      </Text>
      {items.length ? (
        <LibraryPublishedDefinitions items={items} orgId={orgId} />
      ) : (
        <p className="text-body-medium text-on-surface-variant p-4">{empty}</p>
      )}
    </Surface>
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
    <Surface
      as="section"
      shape="large"
      pad="roomy"
      aria-label="Continue defining"
      className="flex flex-col gap-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Text as="h2" token="title-large">
          Continue defining
        </Text>
        <Button
          asChild
          variant="ghost"
          className="coarse:h-auto h-auto min-h-10 max-w-full py-2 whitespace-normal"
        >
          <Link href={workTemplateHref(orgId, '/new')}>Define another kind</Link>
        </Button>
      </div>
      <LibraryDraftDefinitions items={drafts} orgId={orgId} />
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
  const ready = visible.filter(
    (item) => item.status === 'published' && !item.isBase && !libraryHasDraft(item),
  );
  const drafts = visible.filter(libraryHasDraft);
  const defaults = visible.filter((item) => item.isBase && item.status !== 'archived');
  const archived = visible.filter((item) => item.status === 'archived');
  return (
    <ControlGroup controlSize="xl" orientation="vertical" className="gap-5">
      {items.some((item) => !item.isBase) ? (
        <LibrarySearch search={search} kind={kind} setSearch={setSearch} setKind={setKind} />
      ) : null}
      <ContinueDefining drafts={drafts} orgId={orgId} />
      <LibraryDefineEntry
        orgId={orgId}
        continuing={items.some((item) => !item.isBase && item.status !== 'archived')}
      />
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
      {ready.length ||
      search ||
      kind ||
      !visible.some((item) => libraryHasDraft(item) && item.latestVersion) ? (
        <LibraryGroup
          title="Ready to use"
          orgId={orgId}
          items={ready}
          empty={
            search || kind
              ? 'No published definitions match these filters.'
              : 'Published definitions appear here. Your drafts stay private until you publish them.'
          }
        />
      ) : null}
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
