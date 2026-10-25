'use client';
import type { JSX } from 'react';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { Button } from '@docket/ui/primitives';
import { ImmersiveShell } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { LabelConversionPage } from '@/components/templates/label-conversion/page';
import { useAppSearchParams, useTypedRoute } from '@/lib/app-location';
/** Open an isolated explicit review of a published template and existing labelled work. */
export default function ConvertLabelledWorkPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/convert-labels');
  const search = useAppSearchParams(),
    template = WorkTypeId.safeParse(search.get('templateId')),
    version = WorkTypeVersionId.safeParse(search.get('versionId')),
    labelGroupId = search.get('labelGroupId'),
    labelId = search.get('labelId');
  if (!template.success || !version.success)
    return (
      <ImmersiveShell
        header={
          <Button asChild variant="ghost" className="px-0">
            <Link href={`/orgs/${orgId}/work-templates`}>
              <ChevronLeft aria-hidden="true" className="size-4" />
              Work templates
            </Link>
          </Button>
        }
      >
        <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pb-6 sm:px-6">
          <h1 className="text-headline-small">Choose a published template first</h1>
          <p className="text-body-medium">Open a template and choose “Apply to labelled work”.</p>
        </div>
      </ImmersiveShell>
    );
  return (
    <LabelConversionPage
      orgId={orgId}
      templateId={template.data}
      versionId={version.data}
      {...(labelGroupId ? { labelGroupId } : {})}
      {...(labelId ? { labelId } : {})}
    />
  );
}
