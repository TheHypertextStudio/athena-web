'use client';

/**
 * `(app)/calendar/calendar-comparison-controls` — the People popover.
 *
 * @remarks
 * These controls used to render inline in the page's flex column, above the grid: a bordered
 * `<section>` holding a bordered `<Select>` (styled from the *legacy* `border-outline` /
 * `bg-surface` pair, one row away from MD3-tokenized neighbours) and one bordered chip per
 * person carrying a bare checkbox and a name. It cost roughly 90px of vertical budget whenever the
 * People axis was active and was a material contributor to the calendar collapsing to 5.55% of the
 * viewport.
 *
 * Choosing who to compare is a *setting*, so it now lives behind a trailing toolbar control that
 * costs one button of width and nothing when closed. Inside, the border boxes are gone — a popover
 * already is a surface, and a border drawn inside one is pure noise — and every control resolves to
 * the same MD3 token system as the rest of the row. Each person reads as a row with an inline
 * identity glyph and a check on the selected state rather than a bare pill.
 *
 * @see {@link CalendarComparisonControls}
 */
import type { OrgSummary } from '../../../lib/contracts/organization';
import { cn } from '@docket/ui';
import { Check, ChevronDown, Users } from '@docket/ui/icons';
import {
  Avatar,
  AvatarFallback,
  Button,
  focusRingInset,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Select,
} from '@docket/ui/primitives';
import { type JSX, useId } from 'react';

import { CALENDAR_CONTROL_CLASS } from '@/components/calendar/calendar-toolbar-control';

import type { ComparisonMember } from './use-calendar-people-axis';

/**
 * Reduce a display name to at most two initials for the avatar fallback.
 *
 * @param displayName - The member's rendered name.
 * @returns one or two uppercase initials, or `'?'` for an empty name.
 */
function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

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

/**
 * The toolbar's People control — which workspace and which people the lanes compare.
 *
 * @param props - The {@link CalendarComparisonControlsProps}.
 * @returns the trigger and its comparison popover.
 *
 * @example
 * ```tsx
 * <CalendarComparisonControls
 *   workspaces={peopleAxis.sharedWorkspaces}
 *   workspaceId={peopleAxis.comparisonOrgId}
 *   members={peopleAxis.activeMembers}
 *   selectedActorIds={peopleAxis.selectedActorIds}
 *   membersPending={peopleAxis.membersPending}
 *   onWorkspaceChange={peopleAxis.selectWorkspace}
 *   onActorChange={peopleAxis.toggleActor}
 * />
 * ```
 */
export function CalendarComparisonControls({
  workspaces,
  workspaceId,
  members,
  selectedActorIds,
  membersPending,
  onWorkspaceChange,
  onActorChange,
}: CalendarComparisonControlsProps): JSX.Element {
  const peopleLabelId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="People" className={CALENDAR_CONTROL_CLASS}>
          <Users className="size-4" aria-hidden="true" />
          <span className="hidden @2xl:inline">People</span>
          <ChevronDown className="hidden size-4 opacity-60 @2xl:inline" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent presentation="panel" width="xl" align="end" aria-label="People">
        <PopoverBody className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant px-1">Workspace</span>
            <Select
              name="comparison-workspace"
              value={workspaceId}
              onChange={(event) => {
                onWorkspaceChange(event.target.value);
              }}
            >
              {workspaces.length === 0 ? <option value="">No shared workspaces</option> : null}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex min-w-0 flex-col gap-1">
            <span id={peopleLabelId} className="text-label-medium text-on-surface-variant px-1">
              People
            </span>
            {members.length > 0 ? (
              <ul aria-labelledby={peopleLabelId} className="flex flex-col">
                {members.map((member) => {
                  const selected = selectedActorIds.includes(member.actorId);
                  return (
                    <li key={member.actorId}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => {
                          onActorChange(member.actorId, !selected);
                        }}
                        className={cn(
                          'hover:bg-surface-container-highest flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors motion-reduce:transition-none',
                          focusRingInset,
                        )}
                      >
                        <Avatar aria-hidden="true" className="size-6 shrink-0">
                          <AvatarFallback className="text-label-medium">
                            {initials(member.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-body-medium text-on-surface min-w-0 flex-1 truncate">
                          {member.displayName}
                        </span>
                        {selected ? (
                          <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : membersPending ? (
              <p className="text-body-small text-on-surface-variant px-1">Loading people…</p>
            ) : (
              <p role="status" className="text-body-small text-on-surface-variant px-1">
                No people available.
              </p>
            )}
          </div>

          {/*
          The permission model is not obvious from the lanes alone, so it is stated here rather than
          in a bordered box beside the grid — supporting text inside the control it explains.
        */}
          <p className="text-body-small text-on-surface-variant px-1">
            Details appear only from layers each person shared with this workspace. Private provider
            events always appear as Busy.
          </p>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
