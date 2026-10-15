'use client';
import { type JSX, useState } from 'react';
import type { ProjectOut } from '@/lib/contracts/project';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { useApiQuery } from '@/lib/query';

/** Start a published project template inside the current Program through the ordinary composer. */
export function ProgramTemplateCreate({
  orgId,
  programId,
  onCreated,
}: {
  orgId: string;
  programId: string;
  onCreated: (project: ProjectOut) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { openCreate } = useCreateObject();
  const query = useApiQuery({
    ...workTemplatesDef(orgId, { targetType: 'project' }),
    enabled: open,
  });
  const templates = (query.data?.items ?? []).filter(
    (item) => !item.isBase && item.offeredTeamIds.length === 0,
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">New from template</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {query.isError ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void query.refetch();
            }}
          >
            Templates unavailable · Retry
          </DropdownMenuItem>
        ) : query.isPending ? (
          <DropdownMenuItem disabled>Loading templates…</DropdownMenuItem>
        ) : templates.length === 0 ? (
          <DropdownMenuItem disabled>No workspace project templates</DropdownMenuItem>
        ) : (
          templates.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => {
                openCreate({
                  kind: 'project',
                  initialWorkspaceId: orgId,
                  defaultProgramId: programId,
                  defaultTemplateId: item.id,
                  sameWorkspaceCompletion: 'stay',
                  onCreated,
                });
              }}
            >
              New {item.definition.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
