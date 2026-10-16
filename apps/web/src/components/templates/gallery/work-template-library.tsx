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
  Tabs,
  Text,
} from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import { libraryDefinition, libraryHasDraft } from './work-template-library-order';
import { LibraryDefinitions } from './work-template-library-definitions';
import { LibraryEmptyState } from './work-template-library-entry';

const kinds = ['initiative', 'program', 'project', 'task'] as const;
type LibraryState = 'all' | 'drafts' | 'published';

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

function LibraryFilters({
  search,
  kind,
  onSearch,
  onKind,
}: {
  readonly search: string;
  readonly kind: TemplateTargetType | '';
  readonly onSearch: (search: string) => void;
  readonly onKind: (kind: TemplateTargetType | '') => void;
}): JSX.Element {
  return (
    <Collapsible>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Field label="Search work templates">
          <Input
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
            }}
          />
        </Field>
        <CollapsibleTrigger asChild>
          <Button variant={kind ? 'secondary' : 'ghost'} aria-label="Filter by work kind">
            {kind ? 'Filter · 1' : 'Filter'}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-3">
        <LibraryKindFilter kind={kind} onKind={onKind} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function LibraryManagement({
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
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">
          {title} ({items.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <LibraryDefinitions label={title} items={items} orgId={orgId} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function matchesState(item: WorkTemplateOut, state: string): boolean {
  if (state === 'drafts') return libraryHasDraft(item);
  if (state === 'published') return item.latestVersion !== null;
  return true;
}

/** Choose one organizational work definition before entering its focused authoring flow. */
export function WorkTemplateLibrary({
  items,
  orgId,
}: {
  readonly items: readonly WorkTemplateOut[];
  readonly orgId: string;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<TemplateTargetType | ''>('');
  const [state, setState] = useState<LibraryState>('all');
  const active = items.filter((item) => !item.isBase && item.status !== 'archived');
  const visible = active.filter((item) => {
    const definition = libraryDefinition(item, 'authoring');
    return (
      (!kind || item.targetType === kind) &&
      matchesState(item, state) &&
      `${definition.name} ${definition.description ?? ''} ${item.definition.name}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  const defaults = items.filter((item) => item.isBase && item.status !== 'archived');
  const archived = items.filter((item) => item.status === 'archived');
  return (
    <ControlGroup controlSize="xl" orientation="vertical" className="gap-6">
      {active.length ? (
        <section aria-label="Choose a template" className="flex min-w-0 flex-col gap-4">
          <Text as="h2" token="title-large" className="sr-only">
            Work templates
          </Text>
          <LibraryFilters search={search} kind={kind} onSearch={setSearch} onKind={setKind} />
          <Tabs
            label="Definition state"
            value={state}
            onValueChange={(value) => {
              if (value === 'all' || value === 'drafts' || value === 'published') setState(value);
            }}
            items={[
              { value: 'all', label: 'All' },
              { value: 'drafts', label: 'Drafts' },
              { value: 'published', label: 'Published' },
            ]}
          />
          <div role="tabpanel" id={`tabpanel-${state}`} aria-labelledby={`tab-${state}`}>
            {visible.length ? (
              <LibraryDefinitions items={visible} orgId={orgId} />
            ) : (
              <div className="flex flex-col items-start gap-2 py-6">
                <p className="text-body-medium text-on-surface-variant">
                  No work templates match these filters.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setKind('');
                    setState('all');
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <LibraryEmptyState />
      )}
      <div className="flex flex-col items-stretch gap-2">
        <LibraryManagement title="Defaults" orgId={orgId} items={defaults} />
        <LibraryManagement title="Archived" orgId={orgId} items={archived} />
      </div>
    </ControlGroup>
  );
}
