'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { JSX } from 'react';
import { WorkTemplateIdentityControl } from './work-template-identity-control';
import type { WorkTemplatePresentationProps } from './work-template-choice-menu';
import { WorkTemplateCaptureAction } from './work-template-capture-action';

interface HeaderWork {
  readonly id: string;
  readonly workTypeId?: string | undefined;
  readonly workTypeVersionId?: string | undefined;
  readonly teamId?: string | null | undefined;
  readonly leadTeamId?: string | null | undefined;
}

/** Adapt a detail record to the shared header without changing the work's content or permissions. */
export function WorkTemplateHeader({
  orgId,
  kind,
  work,
  canEdit,
  presentation,
  menuLabel,
  menuItems,
}: WorkTemplatePresentationProps & {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly work: HeaderWork;
  readonly canEdit: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <WorkTemplateCaptureAction
        key={`${orgId}:${kind}:${work.id}`}
        orgId={orgId}
        kind={kind}
        workId={work.id}
        renderTrigger={(onCapture) => (
          <WorkTemplateIdentityControl
            orgId={orgId}
            kind={kind}
            workId={work.id}
            teamId={work.teamId ?? work.leadTeamId ?? null}
            workTypeId={work.workTypeId}
            workTypeVersionId={work.workTypeVersionId}
            canEdit={canEdit}
            presentation={presentation}
            menuLabel={menuLabel}
            menuItems={menuItems}
            onCapture={onCapture}
          />
        )}
      />
    </div>
  );
}
