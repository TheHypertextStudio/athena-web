'use client';
import type { JSX } from 'react';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import { PublishAction } from '@/components/publishing/publish-action';
/** Contextual Program actions with the existing full Overview publication behavior. */
export function ProgramHeaderActions({
  orgId,
  programId,
  programName,
  programLabel,
  canEdit,
  compact,
  onDelete,
}: {
  readonly orgId: string;
  readonly programId: string;
  readonly programName: string;
  readonly programLabel: string;
  readonly canEdit: boolean;
  readonly compact: boolean;
  readonly onDelete: () => void;
}): JSX.Element {
  return (
    <ControlGroup controlSize={compact ? 'md' : 'xl'}>
      {!compact ? (
        <PublishAction
          orgId={orgId}
          subjectKind="program"
          subjectId={programId}
          title={programName}
          noun={programLabel}
          canPublish={canEdit}
        />
      ) : null}
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" iconOnly aria-label={`${programLabel} actions`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="sm">
            <DropdownMenuItem
              destructive
              onSelect={() => {
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete {programLabel.toLowerCase()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ControlGroup>
  );
}
