'use client';

/**
 * One rich row on the Initiatives list.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* that holds no work of its own, so its row leads
 * with what actually conveys signal: the theme name + description, the auto-derived status,
 * the rolled-up health verdict, and the membership mix (how many Programs / Projects it
 * spans). The row is a single keyboard-activatable control (a `button`) following the same
 * affordances as the rest of the app — Enter/Space (native to `button`) activate it, it
 * carries a visible focus ring, and the whole surface is clickable. Activation deep-links to
 * the timeline-first detail.
 *
 * The list partitions rows by derived status (Active / Completed) at the page level; this
 * component is purely presentational and reports activation via {@link InitiativeRowProps.onOpen}.
 */
import type { Health, InitiativeStatus } from '@docket/types';
import { Target } from '@docket/ui/icons';
import type { JSX } from 'react';

import { RolledUpHealthPill } from './health-pill';

/** The view-model for one initiative row (already enriched with its child roll-up). */
export interface InitiativeRowData {
  /** The initiative id. */
  readonly id: string;
  /** The theme's display name. */
  readonly name: string;
  /** A short description, when set. */
  readonly description: string | null;
  /** The Initiative's canonical lifecycle status. */
  readonly status: InitiativeStatus;
  /** The rolled-up (worst-child) health verdict, or null when none is set. */
  readonly rolledUpHealth: Health | null;
  /** How many Programs the theme spans. */
  readonly programCount: number;
  /** How many Projects the theme spans. */
  readonly projectCount: number;
}

/** Props for {@link InitiativeRow}. */
export interface InitiativeRowProps {
  /** The row's view-model. */
  initiative: InitiativeRowData;
  /** The singular Program noun (vocabulary-resolved), lower-cased for inline copy. */
  programNoun: string;
  /** The singular Project noun (vocabulary-resolved), lower-cased for inline copy. */
  projectNoun: string;
  /** Called when the row is activated (click / Enter / Space). */
  onOpen: () => void;
}

/** Pluralize a vocabulary noun against a count (naive English plural is sufficient here). */
function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * A keyboard-activatable initiative row.
 *
 * @param props - The {@link InitiativeRowProps}.
 * @returns the rendered row.
 */
export function InitiativeRow({
  initiative,
  programNoun,
  projectNoun,
  onOpen,
}: InitiativeRowProps): JSX.Element {
  const { name, description, rolledUpHealth, programCount, projectCount } = initiative;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring group flex w-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Target aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
          <span className="text-on-surface text-body-medium truncate font-semibold">{name}</span>
        </div>
        <RolledUpHealthPill health={rolledUpHealth} className="shrink-0" />
      </div>

      {description ? (
        <p className="text-on-surface-variant text-body-medium line-clamp-1 pl-[26px]">
          {description}
        </p>
      ) : null}

      <p className="text-on-surface-variant pl-[26px] text-xs">
        Spans {countLabel(programCount, programNoun)} and {countLabel(projectCount, projectNoun)}
      </p>
    </button>
  );
}
