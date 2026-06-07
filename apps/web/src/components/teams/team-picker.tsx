'use client';

/**
 * A compact, styled control for choosing which team a new piece of work lands in.
 *
 * @remarks
 * Org work is always created against a specific team (each team owns its own workflow states
 * and Triage queue). Most orgs have a single team — the seeded "General" team — so this
 * control renders nothing when there is one (or zero) team to choose from: the lone team is
 * implied and a picker would be noise. When an org has several teams it renders a
 * design-system {@link DropdownMenu} radio group so the caller can retarget the create without
 * leaving the inline composer. It is a controlled component: the parent owns the selected
 * `teamId` and is told of changes through {@link TeamPickerProps.onChange}.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` this picker is driven from.
 */
import type { TeamOut } from '@docket/types';
import { ChevronDown, Users } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link TeamPicker}. */
export interface TeamPickerProps {
  /** The teams the work may be created in (typically the active org's teams). */
  teams: readonly TeamOut[];
  /** The currently-selected team id, or `null` before teams resolve. */
  value: string | null;
  /** Notify the parent that a different team was chosen. */
  onChange: (teamId: string) => void;
  /** Disable the control (e.g. while a create is in flight). */
  disabled?: boolean;
  /** Optional extra classes for the trigger button. */
  className?: string;
}

/**
 * The inline team selector for create composers.
 *
 * @param props - The {@link TeamPickerProps}.
 * @returns the rendered picker, or `null` when there is nothing meaningful to choose between.
 */
export function TeamPicker({
  teams,
  value,
  onChange,
  disabled,
  className,
}: TeamPickerProps): JSX.Element | null {
  // With one (or no) team the choice is implied; rendering a picker would only add noise.
  if (teams.length <= 1) return null;

  const selected = teams.find((t) => t.id === value) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`Team — currently ${selected?.name ?? 'none selected'}`}
          className={cn('gap-1.5', className)}
        >
          <Users className="size-4 opacity-70" aria-hidden="true" />
          <span className="max-w-32 truncate">{selected?.name ?? 'Select team'}</span>
          <ChevronDown className="size-4 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>Create in team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? undefined}
          onValueChange={(next) => {
            onChange(next);
          }}
        >
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
