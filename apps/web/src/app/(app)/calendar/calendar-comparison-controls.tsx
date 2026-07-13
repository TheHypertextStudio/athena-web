'use client';

import type { OrgSummary } from '@docket/types';
import type { JSX } from 'react';

import type { ComparisonMember } from './use-calendar-people-axis';

/** Props for selecting the workspace and people represented by comparison lanes. */
export interface CalendarComparisonControlsProps {
  readonly workspaces: readonly OrgSummary[];
  readonly workspaceId: string;
  readonly members: readonly ComparisonMember[];
  readonly selectedActorIds: readonly string[];
  readonly membersPending: boolean;
  readonly onWorkspaceChange: (workspaceId: string) => void;
  readonly onActorChange: (actorId: string, selected: boolean) => void;
}

/** Render controls for an arbitrary number of shared schedule lanes. */
export function CalendarComparisonControls({
  workspaces,
  workspaceId,
  members,
  selectedActorIds,
  membersPending,
  onWorkspaceChange,
  onActorChange,
}: CalendarComparisonControlsProps): JSX.Element {
  return (
    <section
      aria-label="Schedule comparison controls"
      className="border-outline-variant flex flex-wrap items-start gap-4 rounded-lg border p-3"
    >
      <label className="flex min-w-48 flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Workspace</span>
        <select
          name="comparison-workspace"
          value={workspaceId}
          onChange={(event) => {
            onWorkspaceChange(event.target.value);
          }}
          className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {workspaces.length === 0 ? <option value="">No shared workspaces</option> : null}
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="min-w-0 flex-1">
        <legend className="text-on-surface-variant mb-1 text-xs font-medium">People</legend>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => (
            <label
              key={member.actorId}
              className="border-outline-variant hover:bg-surface-container-high focus-within:ring-ring flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-within:ring-2 focus-within:ring-offset-1 motion-reduce:transition-none"
            >
              <input
                name="comparison-actors"
                type="checkbox"
                value={member.actorId}
                checked={selectedActorIds.includes(member.actorId)}
                onChange={(event) => {
                  onActorChange(member.actorId, event.target.checked);
                }}
              />
              {member.displayName}
            </label>
          ))}
          {membersPending ? (
            <span className="text-on-surface-variant text-xs">Loading people…</span>
          ) : members.length === 0 ? (
            <span role="status" className="text-on-surface-variant text-xs">
              No people available.
            </span>
          ) : null}
        </div>
      </fieldset>
    </section>
  );
}
