'use client';

import { ControlGroup, DropdownMenuItem, DropdownMenuSeparator } from '@docket/ui/primitives';
import { RefreshCw, Trash2 } from '@docket/ui/icons';
import type { ComponentProps, JSX } from 'react';
import { PublishAction } from '@/components/publishing/publish-action';
import { WorkTemplateHeader } from '@/components/templates/work-template-header';

/** Publication and contextual actions for one project, including its template provenance. */
export interface ProjectHeaderActionsProps {
  readonly orgId: string;
  readonly work: ComponentProps<typeof WorkTemplateHeader>['work'] & { readonly name: string };
  readonly noun: string;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly onRepeat: () => void;
  readonly onTrash: () => void;
}

/** Keep publishing beside a single persistent menu so its dialogs survive menu dismissal. */
export function ProjectHeaderActions({
  orgId,
  work,
  noun,
  canEdit,
  canDelete,
  onRepeat,
  onTrash,
}: ProjectHeaderActionsProps): JSX.Element {
  return (
    <ControlGroup controlSize="sm">
      <PublishAction
        orgId={orgId}
        subjectKind="project"
        subjectId={work.id}
        title={work.name}
        noun={noun}
        canPublish={canEdit}
      />
      <WorkTemplateHeader
        orgId={orgId}
        kind="project"
        work={work}
        canEdit={canEdit}
        presentation="menu"
        menuLabel={`${noun} actions`}
        menuItems={
          canEdit || canDelete ? (
            <>
              {canEdit ? (
                <DropdownMenuItem onSelect={onRepeat}>
                  <RefreshCw className="size-4" />
                  Repeat {noun.toLowerCase()}
                </DropdownMenuItem>
              ) : null}
              {canEdit && canDelete ? <DropdownMenuSeparator /> : null}
              {canDelete ? (
                <DropdownMenuItem destructive onSelect={onTrash}>
                  <Trash2 className="size-4" />
                  Move {noun.toLowerCase()} to trash
                </DropdownMenuItem>
              ) : null}
            </>
          ) : undefined
        }
      />
    </ControlGroup>
  );
}
