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
import { defaultEntityDisplay, type TeamOut } from '@docket/types';
import { ChevronDown } from '@docket/ui/icons';
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

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';

/** Props for {@link TeamPicker}. */
export interface TeamPickerProps {
  /** The teams the work may be created in (typically the active org's teams). */
  teams: readonly TeamOut[];
  /** The currently-selected team id, or `null` before teams resolve. */
  value: string | null;
  /** Notify the parent that a different team was chosen. */
  onChange: (teamId: string) => void;
  /** Disable the control (e.g. while a create is in flight). */
  disabled?: boolean | undefined;
  /** Optional extra classes for the trigger button. */
  className?: string | undefined;
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
  // Avoid mounting the display query when there is no choice to render. Several lightweight
  // composer hosts intentionally omit a QueryClient when a lone team is implied.
  if (teams.length <= 1) return null;

  return (
    <TeamPickerControl
      teams={teams}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
    />
  );
}

/** Renders the query-backed team selector once a workspace exposes a real choice. */
function TeamPickerControl({
  teams,
  value,
  onChange,
  disabled,
  className,
}: TeamPickerProps): JSX.Element {
  const organizationId = teams[0]?.organizationId ?? '';
  const teamDisplaysQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(organizationId, 'team'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId: organizationId, subjectType: 'team' },
        }),
      'Could not load team icons.',
      { enabled: organizationId.length > 0 },
    ),
  );
  const displayById = new Map(
    (teamDisplaysQ.data?.items ?? []).map((display) => [display.subjectId, display]),
  );
  const selected = teams.find((t) => t.id === value) ?? null;
  const selectedDisplay =
    selected === null
      ? null
      : (displayById.get(selected.id) ?? defaultEntityDisplay('team', selected.id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Team — currently ${selected?.name ?? 'none selected'}`}
          className={cn(
            'text-on-surface h-auto justify-start gap-1.5 px-2 py-1.5 font-normal',
            className,
          )}
        >
          {selectedDisplay === null ? null : (
            <EntityIconGlyph
              iconKey={selectedDisplay.iconKey}
              colorKey={selectedDisplay.colorKey}
              customColor={selectedDisplay.customColor}
              size={16}
            />
          )}
          <span className="max-w-32 truncate">{selected?.name ?? 'Select team'}</span>
          <ChevronDown className="size-4 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="sm">
        <DropdownMenuLabel>Create in team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          {...(value !== null ? { value } : {})}
          onValueChange={(next) => {
            onChange(next);
          }}
        >
          {teams.map((team) => {
            const display = displayById.get(team.id) ?? defaultEntityDisplay('team', team.id);
            return (
              <DropdownMenuRadioItem key={team.id} value={team.id}>
                <EntityIconGlyph
                  iconKey={display.iconKey}
                  colorKey={display.colorKey}
                  customColor={display.customColor}
                  size={16}
                />
                {team.name}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
