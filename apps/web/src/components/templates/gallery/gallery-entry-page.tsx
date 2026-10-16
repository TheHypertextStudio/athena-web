'use client';
import type { JSX } from 'react';
import { WorkTemplateGalleryDetail } from '@docket/work/template-gallery-contract';
import { Skeleton } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { QueryLoadFailure } from '@/components/feedback';
import { sectionHref } from '@/components/settings/settings-registry';
import { templateGalleryEntryDef } from '../work-template-gallery-queries';
import { GalleryEntry } from './gallery-entry';
import { useGalleryWorkspace } from './gallery-workspace';

/** Read one actual released definition and its exact nested references before choosing it. */
export function GalleryEntryPage({ slug }: { readonly slug: string }): JSX.Element {
  const state = useGalleryWorkspace(),
    router = useAppRouter();
  const query = useApiQuery(templateGalleryEntryDef(state.scope.orgId, slug));
  if (query.isError) return <QueryLoadFailure title="Work definition" query={query} />;
  if (query.isPending) return <Skeleton className="h-64" />;
  const { choices } = state.memory;
  const selected = choices.roots.includes(slug);
  return (
    <GalleryEntry
      detail={WorkTemplateGalleryDetail.parse(query.data)}
      selected={selected}
      selectionFull={choices.roots.length >= 100}
      onBack={() => {
        router.push(`${sectionHref(state.scope.orgId, 'templates')}/gallery`, { scroll: false });
      }}
      onSelect={() => {
        state.change({
          ...state.memory,
          choices: {
            ...choices,
            roots: selected
              ? choices.roots.filter((value) => value !== slug)
              : [...choices.roots, slug],
          },
        });
      }}
    />
  );
}
