/**
 * What a detail page shows about an entity it already knows something about.
 *
 * @remarks
 * The failure these guard against is a loading state that has data and renders it badly. A
 * navigation snapshot carries the same status, priority, and health the loaded page shows as chips,
 * and every container detail page used to print them as `{status} · {priority}` — stored keys, in a
 * bare span, with every placeholder in the row deleted to make room for them. A reader arriving on
 * an Initiative saw `proposed · medium` beside a column of grey bars.
 *
 * So these assert two things the old shape could not do at once: a known property is stated the way
 * the loaded page states it, and an unknown one still holds its place.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  InitiativeNavigationSnapshot,
  ProgramNavigationSnapshot,
  ProjectNavigationSnapshot,
} from '../../src/lib/contracts/entity-navigation';
import { EntityDetailSkeleton } from '../../src/components/views/entity-detail-skeleton';
import { EntitySnapshotMetadata } from '../../src/components/views/entity-snapshot-metadata';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ENTITY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const UPDATED_AT = '2026-08-23T11:00:00.000Z';

/** An Initiative identity as a list row would seed it. */
function initiative(overrides: Partial<InitiativeNavigationSnapshot> = {}) {
  return InitiativeNavigationSnapshot.parse({
    target: 'initiative',
    organizationId: ORG_ID,
    id: ENTITY_ID,
    name: 'Westside Transit and Housing Coalition',
    status: 'proposed',
    priority: 'medium',
    health: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

/** A Project identity as a list row would seed it. */
function project(overrides: Partial<ProjectNavigationSnapshot> = {}) {
  return ProjectNavigationSnapshot.parse({
    target: 'project',
    organizationId: ORG_ID,
    id: ENTITY_ID,
    name: 'Corridor study',
    status: 'planned',
    priority: 'high',
    health: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

/** A Program identity as a list row would seed it. */
function program(overrides: Partial<ProgramNavigationSnapshot> = {}) {
  return ProgramNavigationSnapshot.parse({
    target: 'program',
    organizationId: ORG_ID,
    id: ENTITY_ID,
    name: 'Housing delivery',
    status: 'proposed',
    health: 'at_risk',
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

/** Every property slot in the row, and which of them are still placeholders. */
function slotsOf(container: HTMLElement): { total: number; pending: number; stated: number } {
  const items = [...container.querySelectorAll('[data-entity-metadata-item]')];
  const pending = items.filter((item) => item.querySelector('[data-slot="skeleton"]') !== null);
  return { total: items.length, pending: pending.length, stated: items.length - pending.length };
}

describe('EntitySnapshotMetadata', () => {
  it('resolves a stored status key into the name the workspace uses for that stage', () => {
    const { container } = render(<EntitySnapshotMetadata snapshot={initiative()} />);

    const status = container.querySelector('[aria-label^="Status"]');
    expect(status?.textContent).toContain('Proposed');
    // The defect verbatim: a status key is an identifier, so a workspace that renamed this stage
    // still saw the key. Nothing in the row may carry one.
    expect(container.textContent).not.toContain('proposed');
  });

  it('names the property a stated value belongs to, which a bare value never did', () => {
    const { container } = render(<EntitySnapshotMetadata snapshot={initiative()} />);

    // "Medium" alone says nothing about what is medium. The row's chips carry no visible label, so
    // the property name has to reach assistive tech some other way.
    expect(container.querySelector('[aria-label^="Priority"]')).not.toBeNull();
  });

  it('keeps a placeholder in the slot of every property it does not know', () => {
    const { container } = render(<EntitySnapshotMetadata snapshot={initiative()} />);

    // Status and priority are known; health is unset, and target, owner, cadence and labels are
    // still in the aggregate. Supplying a snapshot used to delete all of them.
    expect(slotsOf(container)).toEqual({ total: 7, pending: 5, stated: 2 });
  });

  it('states health once the snapshot carries it, and holds its slot until then', () => {
    const withoutHealth = render(<EntitySnapshotMetadata snapshot={initiative()} />);
    const withHealth = render(
      <EntitySnapshotMetadata snapshot={initiative({ health: 'on_track' })} />,
    );

    expect(withoutHealth.container.querySelector('[aria-label^="Initiative health"]')).toBeNull();
    expect(withHealth.container.querySelector('[aria-label^="Initiative health"]')).not.toBeNull();
    // The slot count is identical either way: stating a value must not change the row's shape.
    expect(slotsOf(withHealth.container).total).toBe(slotsOf(withoutHealth.container).total);
  });

  it('shows a Project no priority, because its loaded property row has none', () => {
    const { container } = render(<EntitySnapshotMetadata snapshot={project()} />);

    // The snapshot carries a priority and the Project page never shows one. Printing it advertised
    // a property that never arrived.
    expect(container.querySelector('[aria-label^="Priority"]')).toBeNull();
    expect(container.textContent).not.toContain('High');
    expect(slotsOf(container)).toEqual({ total: 6, pending: 5, stated: 1 });
  });

  it('matches each entity to its own property set rather than one shared row', () => {
    const { container } = render(<EntitySnapshotMetadata snapshot={program()} />);

    // A Program has four properties — status, health, owner, visibility — and no priority.
    expect(slotsOf(container)).toEqual({ total: 4, pending: 2, stated: 2 });
    expect(container.querySelector('[aria-label^="Priority"]')).toBeNull();
  });
});

describe('EntityDetailSkeleton placeholders', () => {
  it('draws no breadcrumb placeholder for a page that may not have one', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Initiative" />);

    // The layout renders its eyebrow slot only when filled, so a placeholder for a top-level
    // entity appeared and then vanished — the jump the skeleton exists to prevent.
    expect(container.querySelector('.masthead-content > .mb-3')).toBeNull();
  });

  it('draws one where a caller knows a breadcrumb is coming', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Initiative" hasEyebrow />);

    expect(container.querySelector('.masthead-content > .mb-3')).not.toBeNull();
  });

  it('shows a derived glyph instead of a grey square when one can be drawn', () => {
    const { container } = render(
      <EntityDetailSkeleton entityName="Initiative" icon={<span data-testid="derived" />} />,
    );

    expect(container.querySelector('.detail-glyph [data-testid="derived"]')).not.toBeNull();
    expect(container.querySelector('.detail-glyph [data-slot="skeleton"]')).toBeNull();
  });

  it('falls back to a placeholder glyph for a caller that knows neither type nor id', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Initiative" />);

    expect(container.querySelector('.detail-glyph [data-slot="skeleton"]')).not.toBeNull();
  });
});
