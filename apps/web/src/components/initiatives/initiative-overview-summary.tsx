'use client';

/** Connected-work health and scope for an Initiative's document-first overview. */
import type { InitiativeDetail } from '@docket/types';
import { FolderKanban, Layers, Target } from '@docket/ui/icons';
import { DecorativeIcon } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';

/** Props for {@link InitiativeOverviewSummary}. */
export interface InitiativeOverviewSummaryProps {
  /** The Initiative aggregate's connected-work rollups. */
  readonly initiative: InitiativeDetail;
  /** Vocabulary-resolved labels for connected work. */
  readonly programNoun: string;
  readonly projectNoun: string;
}

/** Render connected-work scope without implying that an Initiative owns tasks. */
export function InitiativeOverviewSummary({
  initiative,
  programNoun,
  projectNoun,
}: InitiativeOverviewSummaryProps): JSX.Element {
  const health = initiative.rolledUpHealth;
  const total =
    initiative.distribution.onTrack +
    initiative.distribution.atRisk +
    initiative.distribution.offTrack +
    initiative.distribution.unknown;

  return (
    <section
      aria-label="Connected work rollup"
      className="border-outline-variant bg-surface-container-low flex flex-col gap-5 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DecorativeIcon icon={Target} />
          <h2 className="text-on-surface text-title-small">Connected work</h2>
        </div>
        <div className="text-on-surface-variant text-body-small inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${health ? HEALTH_DOT_CLASS[health] : 'bg-on-surface-variant/50'}`}
          />
          {health ? `Rollup: ${HEALTH_LABEL[health]}` : 'No connected health set'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric
          icon={<Layers className="size-4" />}
          label={`${programNoun}s`}
          value={initiative.childMix.programs}
        />
        <Metric
          icon={<FolderKanban className="size-4" />}
          label={`${projectNoun}s`}
          value={initiative.childMix.projects}
        />
      </div>
      {total > 0 ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-3">
          <HealthCount label="On track" value={initiative.distribution.onTrack} tone="on_track" />
          <HealthCount label="At risk" value={initiative.distribution.atRisk} tone="at_risk" />
          <HealthCount
            label="Off track"
            value={initiative.distribution.offTrack}
            tone="off_track"
          />
          <HealthCount label="No health" value={initiative.distribution.unknown} />
        </dl>
      ) : (
        <p className="text-on-surface-variant text-body-medium">
          Link projects or programs from Connected work to track this initiative's health.
        </p>
      )}
    </section>
  );
}

/** Render one connected-work scope metric. */
function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}): JSX.Element {
  return (
    <div className="border-outline-variant bg-surface-container flex flex-col gap-1 rounded-lg border p-3">
      <span aria-hidden="true" className="text-on-surface-variant">
        {icon}
      </span>
      <span className="text-on-surface text-headline-medium tabular-nums">{value}</span>
      <span className="text-on-surface-variant text-label-medium">{label}</span>
    </div>
  );
}

/** Render a named health-distribution count. */
function HealthCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'on_track' | 'at_risk' | 'off_track';
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${tone ? HEALTH_DOT_CLASS[tone] : 'bg-on-surface-variant/50'}`}
      />
      <dt className="text-on-surface-variant text-label-medium">{label}</dt>
      <dd className="text-on-surface text-body-small ml-auto tabular-nums">{value}</dd>
    </div>
  );
}
