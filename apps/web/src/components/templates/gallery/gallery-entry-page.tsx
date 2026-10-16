'use client';
import type { JSX } from 'react';
import { WorkTemplateGalleryDetail } from '@docket/work/template-gallery-contract';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { QueryLoadFailure } from '@/components/feedback';
import { workTemplateHref } from '../work-template-navigation';
import { WorkTemplateWorkspaceFrame } from '../work-template-workspace-frame';
import { templateGalleryEntryDef } from '../work-template-gallery-queries';
import { GalleryEntry } from './gallery-entry';
import { useGalleryWorkspace } from './gallery-workspace';

/** Read one actual released definition and its exact nested references before choosing it. */
export function GalleryEntryPage({ slug }: { readonly slug: string }): JSX.Element {
  const state = useGalleryWorkspace();
  return (
    <WorkTemplateWorkspaceFrame orgId={state.scope.orgId}>
      <GalleryEntryContent slug={slug} />
    </WorkTemplateWorkspaceFrame>
  );
}
function GalleryEntryContent({ slug }: { readonly slug: string }): JSX.Element {
  const state = useGalleryWorkspace(),
    router = useAppRouter();
  const query = useApiQuery(templateGalleryEntryDef(state.scope.orgId, slug));
  const back = (): void => {
    router.push(workTemplateHref(state.scope.orgId, '/gallery'));
  };
  if (query.isError || query.isPending)
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" className="self-start" onClick={back}>
          Back to gallery
        </Button>
        <h1 className="text-title-large px-3 sm:px-0">Work template</h1>
        {query.isError ? (
          <QueryLoadFailure title="Work template" query={query} />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    );
  const { choices } = state.memory;
  const selected = choices.roots.includes(slug);
  return (
    <GalleryEntry
      detail={WorkTemplateGalleryDetail.parse(query.data)}
      selected={selected}
      onReview={() => {
        router.push(workTemplateHref(state.scope.orgId, '/gallery/review'));
      }}
      selectionFull={choices.roots.length >= 100}
      onBack={() => {
        router.push(workTemplateHref(state.scope.orgId, '/gallery'), { scroll: false });
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
