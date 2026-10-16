'use client';
import { useEffect, type JSX } from 'react';
import {
  WorkTemplateGalleryForkSet,
  type WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { sectionHref } from '@/components/settings/settings-registry';
import { QueryLoadFailure } from '@/components/feedback';
import type { QueryFailureSource } from '@/components/feedback/query-load-failure';
import { Button } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { templateGalleryForkDef } from '../work-template-gallery-queries';
import { useGalleryCatalog } from './use-gallery-catalog';
import { GalleryBrowse } from './gallery-browse';
import { gallerySelectedItems, useGalleryWorkspace } from './gallery-workspace';

/** Browse current complete catalog metadata, preserving explicit selection independently of filters. */
export function GalleryBrowsePage(): JSX.Element {
  const state = useGalleryWorkspace(),
    router = useAppRouter();
  const catalog = useGalleryCatalog(state.scope.orgId);
  const { filters } = state.memory;
  useEffect(() => {
    state.browseReturn.restore();
  }, [state.browseReturn]);
  const query = useApiQuery({
    ...templateGalleryForkDef(state.scope.orgId, filters.fork ?? 'startup'),
    enabled: Boolean(filters.fork),
  });
  const base = `${sectionHref(state.scope.orgId, 'templates')}/gallery`;
  const fork = forkMembership(filters.fork, query);
  const search = filters.search?.toLowerCase() ?? '';
  const items = catalog.items.filter(
    (item) =>
      (!filters.fork || item.forks.includes(filters.fork)) &&
      (!filters.category || item.category === filters.category) &&
      (!filters.targetType || item.targetType === filters.targetType) &&
      `${item.name} ${item.use}`.toLowerCase().includes(search),
  );
  return (
    <SettingsSectionPage
      headingSize="expressive"
      title="Choose starting work"
      description="Start with an outcome, then review the actual work and routines your workspace needs."
      loading={catalog.pending || fork.pending}
      parent={{ label: 'Work templates', href: sectionHref(state.scope.orgId, 'templates') }}
    >
      {catalog.failed ? (
        <QueryLoadFailure title="Work gallery" query={catalog.failure} />
      ) : filters.fork && query.isError ? (
        <QueryLoadFailure title="Starting points" query={query} />
      ) : fork.invalid ? (
        <GalleryForkFailure query={query} />
      ) : (
        <div
          onClickCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            const slug = event.target
              .closest('a[data-gallery-slug]')
              ?.getAttribute('data-gallery-slug');
            if (slug && catalog.items.some((item) => item.slug === slug))
              state.browseReturn.remember(slug);
          }}
        >
          <GalleryBrowse
            view={state.memory.view}
            onView={(view) => {
              state.change((memory) => ({ ...memory, view }));
            }}
            items={items}
            forkItems={fork.items}
            filters={filters}
            selected={gallerySelectedItems(state, catalog.items)}
            baseHref={base}
            onFilters={(next) => {
              state.change((memory) => ({ ...memory, filters: next }));
            }}
            onSelect={(selected) => {
              state.change((memory) => ({
                ...memory,
                choices: { ...memory.choices, roots: selected.map((item) => item.slug) },
              }));
            }}
            onReview={() => {
              router.push(`${base}/review`);
            }}
          />
        </div>
      )}
    </SettingsSectionPage>
  );
}

function forkMembership(
  fork: WorkTemplateGalleryQuery['fork'],
  query: { readonly data: unknown; readonly isPending: boolean },
) {
  const parsed = WorkTemplateGalleryForkSet.safeParse(query.data);
  const matches = parsed.success && parsed.data.fork === fork;
  return {
    pending: Boolean(fork) && query.isPending,
    invalid: Boolean(fork) && !matches,
    items: matches ? parsed.data.items : [],
  };
}
function GalleryForkFailure({ query }: { readonly query: QueryFailureSource }): JSX.Element {
  return (
    <InlineBanner tone="critical" title="Starting points could not load">
      <p>Your selection is still here. Reload these starting points to try again.</p>
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        Reload starting points
      </Button>
    </InlineBanner>
  );
}
