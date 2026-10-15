'use client';
import type { JSX } from 'react';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateDraftFields } from './work-template-draft';
import type { TemplateApplication } from './use-template-application';
import { WorkTemplatePicker } from './work-template-picker';
import { TemplateApplicationPreview } from './template-application-preview';

/** Persistent identity, unpublished-draft attribution, and explicit starting-field choice. */
export function ComposerTemplateSelection({
  orgId,
  kind,
  teamId,
  selection,
  disabled,
  application,
}: {
  orgId: string;
  kind: TemplateTargetType;
  teamId: string | null;
  selection: WorkTemplateDraftFields | undefined;
  disabled: boolean;
  application: TemplateApplication;
}): JSX.Element {
  return (
    <>
      <WorkTemplatePicker
        orgId={orgId}
        kind={kind}
        teamId={teamId}
        selectedId={selection?.workTypeId}
        selectedVersionId={selection?.workTypeVersionId}
        disabled={disabled}
        onSelect={application.choose}
      />
      {application.startingDraft ? (
        <span className="text-body-small text-on-surface-variant">
          Starting draft: {application.startingDraft}
        </span>
      ) : null}
      <TemplateApplicationPreview
        name={application.pendingName}
        onClose={application.cancel}
        onApply={application.confirm}
      />
    </>
  );
}
