'use client';

/**
 * The Overview tab's answer to "is the work under this Initiative going well?".
 *
 * @remarks
 * Deliberately not the Connected work list again. Overview summarises; the tab beside it holds the
 * rows, their statuses, and every control that changes them. The one thing the rows cannot show at
 * a glance is how health is spread across all of them, so that is what lives here — plus the way
 * in, because an Initiative created a minute ago has no work yet and this is the first screen its
 * author sees.
 */
import type {
  InitiativeConnectedWork,
  InitiativeHealthDistribution,
} from '@docket/work/initiative-contract';
import { Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { DistributionBar } from '@/components/initiatives/distribution-bar';
import { describeConnectedWork } from '@/components/initiatives/initiative-connected-work';

/** Props for {@link InitiativeWorkSummary}. */
export interface InitiativeWorkSummaryProps {
  readonly connectedWork: readonly InitiativeConnectedWork[];
  /** How the connected work is spread across the health buckets. */
  readonly distribution: InitiativeHealthDistribution;
  /** True while the deferred relationship read is in flight. */
  readonly loading: boolean;
  /** Whether the viewer may create work under this Initiative. */
  readonly canEdit: boolean;
  readonly initiativeNoun: string;
  readonly programNoun: string;
  readonly projectNoun: string;
  /** Open the full Project composer, pre-seeded with this Initiative. */
  readonly onCreateProject: () => void;
}

/** The Overview tab's connected-work summary. */
export function InitiativeWorkSummary({
  connectedWork,
  distribution,
  loading,
  canEdit,
  initiativeNoun,
  programNoun,
  projectNoun,
  onCreateProject,
}: InitiativeWorkSummaryProps): JSX.Element | null {
  // Nothing at all while the deferred read is in flight: a skeleton here would claim the Overview
  // document is still arriving when it is already readable.
  if (loading) return null;

  const createButton = canEdit ? (
    <Button type="button" variant="secondary" className="gap-1.5" onClick={onCreateProject}>
      <Plus aria-hidden className="size-4" />
      New {projectNoun.toLowerCase()}
    </Button>
  ) : null;

  if (connectedWork.length === 0) {
    return (
      <section
        className="flex flex-wrap items-center justify-between gap-3"
        aria-label="Connected work"
      >
        <p className="text-on-surface-variant text-body-medium">
          No {projectNoun.toLowerCase()}s advance this {initiativeNoun.toLowerCase()} yet.
        </p>
        {createButton}
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label="Connected work">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-on-surface text-body-medium">
          {describeConnectedWork(connectedWork, programNoun, projectNoun)}
        </p>
        {createButton}
      </div>
      <DistributionBar
        distribution={distribution}
        childNounPlural={`${projectNoun.toLowerCase()}s and ${programNoun.toLowerCase()}s`}
      />
    </section>
  );
}
