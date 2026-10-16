'use client';
import { useState, type JSX } from 'react';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import {
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  Input,
  Select,
  Surface,
  Tabs,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import Link from '@/components/docket-link';
import {
  GALLERY_CATEGORIES,
  GALLERY_FORKS,
  GALLERY_OUTCOMES,
  galleryItemKey,
} from './gallery-metadata';

/** Controlled browse decisions; server paging/full-fork facts remain separate from visible rows. */
export interface GalleryBrowseProps {
  readonly view?: 'suggested' | 'all';
  readonly onView?: (view: 'suggested' | 'all') => void;
  readonly items: readonly WorkTemplateGalleryItem[];
  readonly forkItems: readonly WorkTemplateGalleryItem[];
  readonly filters: WorkTemplateGalleryQuery;
  readonly selected: readonly WorkTemplateGalleryItem[];
  readonly baseHref: string;
  readonly onFilters: (filters: WorkTemplateGalleryQuery) => void;
  readonly onSelect: (items: readonly WorkTemplateGalleryItem[]) => void;
  readonly onReview: () => void;
}
function CatalogRow({
  item,
  selected,
  href,
  onToggle,
}: {
  readonly item: WorkTemplateGalleryItem;
  readonly selected: boolean;
  readonly href: string;
  readonly onToggle: () => void;
}): JSX.Element {
  const kind = useVocabulary(item.targetType);
  return (
    <li className="flex min-w-0 items-start gap-2 py-3">
      <label className="flex min-h-10 min-w-10 items-center justify-center">
        <Checkbox aria-label={`Select ${item.name}`} checked={selected} onChange={onToggle} />
      </label>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          data-gallery-slug={item.slug}
          className="text-title-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
        >
          {item.name}
        </Link>
        <p className="text-label-medium text-on-surface-variant">{kind}</p>
        <p className="text-body-medium text-on-surface-variant break-words">{item.use}</p>
      </div>
    </li>
  );
}
function browseGroups(props: GalleryBrowseProps, suggested: boolean) {
  const fork = props.filters.fork;
  return suggested && fork
    ? GALLERY_OUTCOMES[fork].map((outcome) => ({
        label: outcome.name,
        items: props.forkItems.filter((item) => outcome.slugs.includes(item.slug)),
      }))
    : GALLERY_CATEGORIES.map((category) => ({
        label: category.label,
        items: props.items.filter((item) => item.category === category.value),
      }));
}
/** Outcome-first catalog selection with exact full-fork scope and independent detail links. */
export function GalleryBrowse(props: GalleryBrowseProps): JSX.Element {
  const [localSuggested, setLocalSuggested] = useState(
    !props.filters.search && !props.filters.category && !props.filters.targetType,
  );
  const suggested = props.view ? props.view === 'suggested' : localSuggested;
  function setSuggested(value: boolean): void {
    setLocalSuggested(value);
    props.onView?.(value ? 'suggested' : 'all');
  }
  const [selectionError, setSelectionError] = useState(false);
  const selected = new Set(props.selected.map(galleryItemKey));
  function changeSelection(items: readonly WorkTemplateGalleryItem[]): void {
    setSelectionError(items.length > 100);
    if (items.length <= 100) props.onSelect(items);
  }
  function toggle(item: WorkTemplateGalleryItem): void {
    changeSelection(
      selected.has(galleryItemKey(item))
        ? props.selected.filter((value) => galleryItemKey(value) !== galleryItemKey(item))
        : [...props.selected, item],
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <GalleryBrowseBody
        props={{ ...props, onSelect: changeSelection }}
        suggested={suggested}
        onSuggested={setSuggested}
        selected={selected}
        onToggle={toggle}
      />
      {selectionError ? (
        <InlineBanner tone="warning" title="Review a smaller selection">
          Choose up to 100 starting definitions. Remove some work before adding more.
        </InlineBanner>
      ) : null}
      {props.selected.length ? (
        <GallerySelectionBar selected={props.selected} onReview={props.onReview} />
      ) : null}
    </div>
  );
}
function GalleryBrowseBody({
  props,
  suggested,
  onSuggested,
  selected,
  onToggle,
}: {
  readonly props: GalleryBrowseProps;
  readonly suggested: boolean;
  readonly onSuggested: (value: boolean) => void;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (item: WorkTemplateGalleryItem) => void;
}): JSX.Element {
  const fork = props.filters.fork;
  if (!fork && suggested)
    return (
      <GalleryAudienceStart
        onChoose={(value) => {
          onSuggested(true);
          props.onFilters({ fork: value });
        }}
        onAll={() => {
          onSuggested(false);
        }}
      />
    );
  const groups = browseGroups(props, suggested);
  return (
    <>
      <GalleryFilters
        filters={props.filters}
        onFilters={(filters) => {
          onSuggested(
            Boolean(filters.fork) &&
              filters.fork !== props.filters.fork &&
              !filters.search &&
              !filters.category &&
              !filters.targetType,
          );
          props.onFilters(filters);
        }}
      />
      <GalleryBrowseGroups
        groups={groups}
        selected={selected}
        suggested={suggested}
        baseHref={props.baseHref}
        onToggle={onToggle}
      />{' '}
      <GalleryBrowseActions
        props={props}
        suggested={suggested}
        onView={(value) => {
          onSuggested(value);
          if (value) props.onFilters({ fork: props.filters.fork });
        }}
      />
    </>
  );
}
function GalleryAudienceStart({
  onChoose,
  onAll,
}: {
  readonly onChoose: (fork: NonNullable<WorkTemplateGalleryQuery['fork']>) => void;
  readonly onAll: () => void;
}): JSX.Element {
  return (
    <Surface
      as="section"
      tone="prominent"
      shape="large"
      pad="roomy"
      aria-label="Organization starting points"
    >
      <h2 className="text-headline-small">What are you organizing?</h2>
      <p className="text-body-large py-3">
        Choose a starting point. You’ll review everything before it is added.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {GALLERY_FORKS.map((fork) => (
          <Button
            key={fork.value}
            variant="secondary"
            className="coarse:h-auto h-auto min-h-12 flex-col items-start py-3 text-left whitespace-normal"
            onClick={() => {
              onChoose(fork.value);
            }}
          >
            <span className="text-title-medium">{fork.label}</span>
            <span className="text-body-small">
              {GALLERY_OUTCOMES[fork.value]
                .slice(0, 2)
                .map((outcome) => outcome.name)
                .join(' · ')}
            </span>
          </Button>
        ))}
      </div>
      <Button className="mt-3" variant="ghost" onClick={onAll}>
        Browse all work definitions
      </Button>
    </Surface>
  );
}
function GalleryBrowseGroups({
  groups,
  selected,
  suggested,
  baseHref,
  onToggle,
}: {
  readonly groups: ReturnType<typeof browseGroups>;
  readonly selected: ReadonlySet<string>;
  readonly suggested: boolean;
  readonly baseHref: string;
  readonly onToggle: (item: WorkTemplateGalleryItem) => void;
}): JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${suggested ? 'suggested' : 'all'}`}
      aria-labelledby={`tab-${suggested ? 'suggested' : 'all'}`}
      className="flex min-w-0 flex-col gap-5"
    >
      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <Surface
            key={group.label}
            as="section"
            shape="large"
            pad="roomy"
            aria-label={group.label}
          >
            <h2 className="text-title-large">{group.label}</h2>
            <ul>
              {group.items.map((item) => (
                <CatalogRow
                  key={galleryItemKey(item)}
                  item={item}
                  selected={selected.has(galleryItemKey(item))}
                  href={`${baseHref}/${item.slug}`}
                  onToggle={() => {
                    onToggle(item);
                  }}
                />
              ))}
            </ul>
          </Surface>
        ))}
      {!groups.some((group) => group.items.length) ? (
        <p>No templates match these filters.</p>
      ) : null}
    </div>
  );
}
function GallerySelectionBar(
  props: Pick<GalleryBrowseProps, 'selected' | 'onReview'>,
): JSX.Element {
  return (
    <Surface
      as="footer"
      tone="floating"
      shape="large"
      pad="roomy"
      className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3"
    >
      <p role="status" className="text-label-large">
        {props.selected.length} selected
      </p>
      <Button disabled={!props.selected.length} onClick={props.onReview}>
        Review selection
      </Button>
    </Surface>
  );
}
function GalleryBrowseActions({
  props,
  onView,
  suggested,
}: {
  readonly suggested: boolean;
  readonly props: GalleryBrowseProps;
  readonly onView: (suggested: boolean) => void;
}): JSX.Element {
  const forkLabel = GALLERY_FORKS.find((item) => item.value === props.filters.fork);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        label="Gallery view"
        value={suggested ? 'suggested' : 'all'}
        onValueChange={(value) => {
          onView(value === 'suggested');
        }}
        items={[
          { value: 'suggested', label: 'Suggested', disabled: !props.filters.fork },
          { value: 'all', label: 'All templates' },
        ]}
      />
      {forkLabel ? (
        <Button
          variant="ghost"
          disabled={!props.forkItems.length}
          onClick={() => {
            props.onSelect([
              ...new Map(
                [...props.selected, ...props.forkItems].map((item) => [galleryItemKey(item), item]),
              ).values(),
            ]);
          }}
        >
          {forkLabel.all} ({props.forkItems.length})
        </Button>
      ) : null}
    </div>
  );
}
function GalleryFilters({
  filters,
  onFilters,
}: Pick<GalleryBrowseProps, 'filters' | 'onFilters'>): JSX.Element {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_1fr]">
      <Select
        aria-label="Starting points for"
        value={filters.fork ?? ''}
        onChange={(event) => {
          onFilters({
            ...filters,
            fork: GALLERY_FORKS.find((fork) => fork.value === event.target.value)?.value,
          });
        }}
      >
        <option value="">All audiences</option>
        {GALLERY_FORKS.map((fork) => (
          <option key={fork.value} value={fork.value}>
            {fork.label}
          </option>
        ))}
      </Select>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">Find specific work</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3 py-3 sm:grid-cols-2">
          <Field label="Search templates">
            <Input
              value={filters.search ?? ''}
              onChange={(event) => {
                onFilters({ ...filters, search: event.target.value });
              }}
            />
          </Field>

          <Field label="Category">
            <Select
              value={filters.category ?? ''}
              onChange={(event) => {
                onFilters({
                  ...filters,
                  category: GALLERY_CATEGORIES.find(
                    (category) => category.value === event.target.value,
                  )?.value,
                });
              }}
            >
              <option value="">All categories</option>
              {GALLERY_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </Select>
          </Field>
          <WorkKindFilter filters={filters} onFilters={onFilters} />
          <Button
            variant="ghost"
            onClick={() => {
              onFilters({});
            }}
          >
            Clear filters
          </Button>
        </CollapsibleContent>
      </Collapsible>
      <AppliedGalleryFilters filters={filters} />
    </div>
  );
}
function AppliedGalleryFilters({
  filters,
}: {
  readonly filters: WorkTemplateGalleryQuery;
}): JSX.Element | null {
  const category = GALLERY_CATEGORIES.find((item) => item.value === filters.category);
  const labels = [
    category ? `Category: ${category.label}` : '',
    filters.targetType ? `Work kind: ${filters.targetType}` : '',
  ].filter(Boolean);
  return labels.length ? (
    <p className="text-body-small text-on-surface-variant">{labels.join(' · ')}</p>
  ) : null;
}
function WorkKindFilter({
  filters,
  onFilters,
}: Pick<GalleryBrowseProps, 'filters' | 'onFilters'>): JSX.Element {
  const task = useVocabulary('task'),
    project = useVocabulary('project'),
    program = useVocabulary('program'),
    initiative = useVocabulary('initiative');
  const kinds = [
    { value: 'task', label: task },
    { value: 'project', label: project },
    { value: 'program', label: program },
    { value: 'initiative', label: initiative },
  ] as const;
  return (
    <Field label="Work kind">
      <Select
        value={filters.targetType ?? ''}
        onChange={(event) => {
          onFilters({
            ...filters,
            targetType: kinds.find((kind) => kind.value === event.target.value)?.value,
          });
        }}
      >
        <option value="">All kinds</option>
        {kinds.map((kind) => (
          <option key={kind.value} value={kind.value}>
            {kind.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
