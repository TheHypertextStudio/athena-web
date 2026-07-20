'use client';

/**
 * `settings/team-mapping-picker` — per-external-team routing control for work-graph connectors.
 *
 * @remarks
 * Renders one row per external team (fetched live from `GET /:id/lists`) with a Docket-team
 * `<select>`. Choosing "Not synced" — the default for a team not yet present in
 * `config.teamMappings` — excludes that external team from the mapping table entirely: an
 * external team absent from `teamMappings` is NOT synced (no fallback), so "Not synced" is a
 * real, explicit state rather than a placeholder. Controlled: the caller owns the mapping state
 * (external team id -> Docket team id) and this component only renders it and reports changes.
 */
import type { ConnectorResourceRef, TeamOut } from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The mapping value for an external team that is not synced. */
export const NOT_SYNCED = '';

/** Props for {@link TeamMappingPicker}. */
export interface TeamMappingPickerProps {
  /** External teams exposed by the connector (from `GET /:id/lists`). */
  externalTeams: readonly ConnectorResourceRef[];
  /** Whether the external-team fetch is still in flight. */
  loading: boolean;
  /** The live fetch's error message, when it failed (a broken credential surfaces here). */
  error: string | null;
  /** Org teams offered as mapping targets. */
  orgTeams: readonly TeamOut[];
  /** The singular noun for one external team ("team"), for empty-state copy. */
  containerNoun: string;
  /** Current mapping: external team id -> Docket team id. A missing entry reads as "Not synced". */
  mapping: Record<string, string>;
  /** Called with the external team id and the newly chosen Docket team id (`''` = not synced). */
  onChange: (externalTeamId: string, teamId: string) => void;
}

/** TeamMappingPicker renders one Docket-team select per external team, defaulting to "Not synced". */
export default function TeamMappingPicker({
  externalTeams,
  loading,
  error,
  orgTeams,
  containerNoun,
  mapping,
  onChange,
}: TeamMappingPickerProps): JSX.Element {
  if (loading) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }
  if (error) {
    return <p className="text-destructive text-xs">{error}</p>;
  }
  if (externalTeams.length === 0) {
    return (
      <p className="text-on-surface-variant text-xs">No {containerNoun}s found for this account.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {externalTeams.map((team) => (
        <li key={team.id} className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
            {team.title}
          </span>
          <select
            aria-label={`Docket team for ${team.title}`}
            value={mapping[team.id] ?? NOT_SYNCED}
            onChange={(e) => {
              onChange(team.id, e.target.value);
            }}
            className="border-outline-variant bg-surface-container-low text-on-surface text-body-medium focus-visible:ring-ring shrink-0 rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
          >
            <option value={NOT_SYNCED}>Not synced</option>
            {orgTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
