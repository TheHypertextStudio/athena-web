'use client';
import type { JSX } from 'react';
import { WorkTemplateCopyBundle } from '@docket/work/template-gallery-contract';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { workTemplateHref } from '../work-template-navigation';
import { WorkTemplateWorkspaceFrame } from '../work-template-workspace-frame';
import { QueryLoadFailure } from '@/components/feedback';
import { templateGalleryCopyBundleDef } from '../work-template-gallery-queries';
import { useGalleryBundleUndo } from './use-gallery-bundle-undo';
import { GalleryCopyBundle } from './gallery-copy-bundle';
import { useGalleryWorkspace } from './gallery-workspace';

/** Reenter persisted copies through current authorized canonical drafts and their actual original outcome. */
export function GalleryBundlePage({ bundleId }: { readonly bundleId: string }): JSX.Element {
  const state = useGalleryWorkspace(),
    router = useAppRouter();
  const query = useApiQuery(templateGalleryCopyBundleDef(state.scope.orgId, bundleId));
  const undo = useGalleryBundleUndo(state.scope.orgId, bundleId);
  const saved = query.data ? WorkTemplateCopyBundle.parse(query.data) : null;
  const bundle = saved && undo.outcome ? { ...saved, receipt: undo.outcome.receipt } : saved;
  const href = workTemplateHref(state.scope.orgId);
  return (
    <WorkTemplateWorkspaceFrame
      orgId={state.scope.orgId}
      title="Saved starting work"
      parent={{ label: 'Work templates', href }}
      loading={query.isPending}
    >
      {query.isError ? (
        <QueryLoadFailure title="Saved work definitions" query={query} />
      ) : bundle ? (
        <GalleryCopyBundle
          bundle={bundle}
          undo={undo}
          orgId={state.scope.orgId}
          onNew={() => {
            router.push(`${href}/gallery`);
          }}
        />
      ) : null}
    </WorkTemplateWorkspaceFrame>
  );
}
