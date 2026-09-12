'use client';

/**
 * The metadata row a detail page shows while its aggregate is still in flight.
 *
 * @remarks
 * A navigation snapshot seeded from the list row the reader clicked already carries an entity's
 * status, priority, and health — the same values the loaded page renders as chips. Three detail
 * pages and the offline route outlet each used to print them as `{status} · {priority}` in a bare
 * span, which put stored keys on screen: a status key is a workspace's identifier for a stage, not
 * its name for it, so a workspace that renamed "proposed" to "Under review" still saw `proposed`.
 * The priority arrived beside it as a lone word with nothing saying it was a priority.
 *
 * The rule here is that a known property renders the way the loaded page renders it — same chip,
 * same glyph, same resolved label, same slot — and an unknown one renders a placeholder in its own
 * slot. The previous shape could not express the second half: the skeleton's metadata slot took a
 * single node, so supplying a snapshot deleted every placeholder and the row lost any sign that
 * more was coming.
 *
 * Each branch below mirrors that entity's property panel, including what the panel omits. A
 * Project detail row has no priority chip, so a loading Project shows no priority — printing one
 * advertises a property that never arrives.
 */
import type { Health } from '@docket/work/capability-contract';
import type { WorkStatusEntityType } from '@docket/work/work-status-contract';
import { StatusIcon } from '@docket/ui/components';
import { SkeletonChip } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { defaultEntityDisplay } from '@docket/work/entity-display-contract';

import { EntityIconSlot } from '@/components/entity-display/entity-icon-glyph';
import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { INITIATIVE_PRIORITY_LABEL } from '@/components/initiatives/priority';
import type { EntityNavigationSnapshot } from '@/lib/contracts/entity-navigation';

import {
  EntityMetadataItem,
  EntityMetadataStaticChip,
  type EntityMetadataPriority,
} from './entity-detail-layout';
import { EntityDetailSkeleton } from './entity-detail-skeleton';

/** A snapshot whose entity's masthead is the shared entity-detail layout. */
export type ContainerNavigationSnapshot = Exclude<
  EntityNavigationSnapshot,
  { readonly target: 'task' }
>;

/** Props for {@link EntityStatusChip}. */
interface EntityStatusChipProps {
  /** Which of the workspace's status sets the key belongs to. */
  entityType: WorkStatusEntityType;
  /** The stored status key carried by the snapshot. */
  statusKey: string;
}

/**
 * A status stated as a chip, resolved through the workspace's own set.
 *
 * @remarks
 * Safe during loading: the registry is mounted at the shell and answers from seeded defaults before
 * the workspace's own sets arrive, so this resolves a name rather than throwing or blanking.
 *
 * @param props - The {@link EntityStatusChipProps}.
 * @returns the status chip.
 */
function EntityStatusChip({ entityType, statusKey }: EntityStatusChipProps): JSX.Element {
  const status = useWorkStatus(entityType, statusKey);
  return (
    <EntityMetadataStaticChip
      icon={<StatusIcon type={status.category} label={status.name} />}
      label={status.name}
      ariaLabel="Status"
    />
  );
}

/** Props for {@link HealthChip}. */
interface HealthChipProps {
  /** The verdict to state. An unset health renders a placeholder instead, never this chip. */
  health: Health;
  /** Names the property, which Initiatives call "Initiative health" and the others call "Health". */
  ariaLabel: string;
}

/**
 * Health stated as a chip, matching the dot the health picker's options carry.
 *
 * @param props - The {@link HealthChipProps}.
 * @returns the health chip.
 */
function HealthChip({ health, ariaLabel }: HealthChipProps): JSX.Element {
  return (
    <EntityMetadataStaticChip
      icon={<span className={`size-2.5 rounded-full ${HEALTH_FILL_CLASS[health]}`} />}
      label={HEALTH_LABEL[health]}
      ariaLabel={ariaLabel}
    />
  );
}

/** Props for {@link PendingProperty}. */
interface PendingPropertyProps {
  /** The slot this property occupies in its panel's inline-disclosure order. */
  priority: EntityMetadataPriority;
}

/**
 * A placeholder standing in one property's slot.
 *
 * @param props - The {@link PendingPropertyProps}.
 * @returns the placeholder chip in its slot.
 */
function PendingProperty({ priority }: PendingPropertyProps): JSX.Element {
  return (
    <EntityMetadataItem priority={priority}>
      {/* placeholder: one property whose value is part of the aggregate still being read. */}
      <SkeletonChip />
    </EntityMetadataItem>
  );
}

/** Props for {@link EntitySnapshotMetadata}. */
export interface EntitySnapshotMetadataProps {
  /** The identity seeded by the surface the reader navigated from. */
  snapshot: ContainerNavigationSnapshot;
}

/**
 * Render a loading detail page's property row from the identity it already holds.
 *
 * @param props - The {@link EntitySnapshotMetadataProps}.
 * @returns the row's full contents: a stated chip per known property, a placeholder per pending one.
 */
export function EntitySnapshotMetadata({ snapshot }: EntitySnapshotMetadataProps): JSX.Element {
  switch (snapshot.target) {
    // Mirrors InitiativePropertiesPanel: Status, Health, Target, Owner, Priority, Cadence, Labels.
    case 'initiative':
      return (
        <>
          <EntityMetadataItem priority={0}>
            <EntityStatusChip entityType="initiative" statusKey={snapshot.status} />
          </EntityMetadataItem>
          {snapshot.health === null ? (
            <PendingProperty priority={1} />
          ) : (
            <EntityMetadataItem priority={1}>
              <HealthChip health={snapshot.health} ariaLabel="Initiative health" />
            </EntityMetadataItem>
          )}
          <PendingProperty priority={2} />
          <PendingProperty priority={3} />
          <EntityMetadataItem priority={4}>
            <EntityMetadataStaticChip
              label={INITIATIVE_PRIORITY_LABEL[snapshot.priority]}
              ariaLabel="Priority"
            />
          </EntityMetadataItem>
          <PendingProperty priority={5} />
          <PendingProperty priority={6} />
        </>
      );
    // Mirrors the Project PropertiesPanel: Status, Health, Timeline, Program, Initiatives, Labels.
    // It carries no priority chip, so neither does this.
    case 'project':
      return (
        <>
          <EntityMetadataItem priority={0}>
            <EntityStatusChip entityType="project" statusKey={snapshot.status} />
          </EntityMetadataItem>
          {snapshot.health === null ? (
            <PendingProperty priority={1} />
          ) : (
            <EntityMetadataItem priority={1}>
              <HealthChip health={snapshot.health} ariaLabel="Health" />
            </EntityMetadataItem>
          )}
          <PendingProperty priority={2} />
          <PendingProperty priority={3} />
          <PendingProperty priority={4} />
          <PendingProperty priority={5} />
        </>
      );
    // Mirrors ProgramPropertiesPanel: Status, Health, Owner, Visibility.
    case 'program':
      return (
        <>
          <EntityMetadataItem priority={0}>
            <EntityStatusChip entityType="program" statusKey={snapshot.status} />
          </EntityMetadataItem>
          {snapshot.health === null ? (
            <PendingProperty priority={1} />
          ) : (
            <EntityMetadataItem priority={1}>
              <HealthChip health={snapshot.health} ariaLabel="Health" />
            </EntityMetadataItem>
          )}
          <PendingProperty priority={2} />
          <PendingProperty priority={3} />
        </>
      );
  }
}

/** Props for {@link ContainerDetailLoading}. */
export interface ContainerDetailLoadingProps {
  /** Which container this is, which selects its derived glyph and its property set. */
  target: ContainerNavigationSnapshot['target'];
  /** The container's id, which the derived glyph's color is keyed on. */
  id: string;
  /** The workspace's noun for this kind of container. */
  entityName: string;
  /** How many tabs the loaded page will show. */
  tabCount: number;
  /** The identity seeded by the surface the reader navigated from, when there is one. */
  snapshot?: ContainerNavigationSnapshot | null | undefined;
}

/**
 * A container detail page's loading surface, stating everything already known about it.
 *
 * @remarks
 * The whole loading branch of a detail page, so the page itself holds one element rather than a
 * cluster of conditionals deciding what it may show. The glyph is derived rather than placeheld:
 * an uncustomized entity's icon and color come from its type and id, which this has.
 *
 * @param props - The {@link ContainerDetailLoadingProps}.
 * @returns the loading surface.
 */
export function ContainerDetailLoading({
  target,
  id,
  entityName,
  tabCount,
  snapshot,
}: ContainerDetailLoadingProps): JSX.Element {
  return (
    <EntityDetailSkeleton
      tabCount={tabCount}
      entityName={entityName}
      title={snapshot?.name}
      icon={
        <EntityIconSlot
          display={defaultEntityDisplay(target, id)}
          entityName={snapshot?.name ?? entityName}
          size={48}
        />
      }
      snapshotMetadata={snapshot ? <EntitySnapshotMetadata snapshot={snapshot} /> : undefined}
    />
  );
}
