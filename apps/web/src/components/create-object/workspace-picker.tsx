'use client';

import { Building } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Select } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useCreationContext } from './creation-context';

/** Props for {@link WorkspacePicker}. */
export interface WorkspacePickerProps {
  /** Disable destination changes while the composer is submitting. */
  readonly disabled?: boolean;
  /** Optional additional classes for the picker or static label. */
  readonly className?: string;
}

/**
 * Select the workspace in which the active composer will create its object.
 *
 * @remarks
 * A single available workspace is rendered as quiet, static context rather than a control that
 * cannot make a choice. Multiple workspaces use the design-system's token-backed native select;
 * changing it updates only the creation target and never the background shell.
 */
export function WorkspacePicker({
  disabled = false,
  className,
}: WorkspacePickerProps): JSX.Element {
  const { workspaces, targetWorkspaceId, workspace, setTargetWorkspaceId } = useCreationContext();
  const selected = workspaces.find((candidate) => candidate.id === targetWorkspaceId) ?? null;

  if (workspaces.length <= 1) {
    const label =
      selected?.name ?? workspace?.name ?? workspaces[0]?.name ?? 'No workspace available';
    return (
      <div
        className={cn(
          'text-on-surface-variant text-label-large flex min-h-8 items-center gap-1.5 px-2',
          className,
        )}
      >
        <Building className="size-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="max-w-48 truncate">{label}</span>
      </div>
    );
  }

  return (
    <label className={cn('flex min-w-48 items-center gap-1.5', className)}>
      <Building className="text-on-surface-variant size-4 shrink-0 opacity-70" aria-hidden="true" />
      <span className="sr-only">Workspace</span>
      <Select
        aria-label="Workspace"
        value={targetWorkspaceId ?? ''}
        disabled={disabled}
        variant="plain"
        controlSize="sm"
        onChange={(event) => {
          setTargetWorkspaceId(event.target.value);
        }}
      >
        {targetWorkspaceId === null ? <option value="">Select workspace</option> : null}
        {workspaces.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
