import type { InitiativeOverviewItem } from '@docket/work/initiative-contract';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildInitiativeCatalog,
  formatInitiativeTarget,
  initiativeTargetTimeframeKey,
} from '../../../src/components/initiatives/initiative-catalog';
import { formatPlanningDate } from '../../../src/components/initiatives/format-date';
import { InitiativePropertiesPanel } from '../../../src/components/initiatives/properties-panel';
import { findField, optionsFor } from '../../../src/components/views/field-catalog';
import { assertDefined } from '@docket/test-utils';

afterEach(cleanup);

/** Construct the fields the planning catalog reads without hiding them behind schema defaults. */
function initiative(
  overrides: Partial<Omit<InitiativeOverviewItem, 'id' | 'organizationId'>> & {
    readonly id?: string;
    readonly organizationId?: string;
  } = {},
): InitiativeOverviewItem {
  return {
    id: '1N1T1AT1VE0000000000000001',
    organizationId: '0RG00000000000000000000001',
    organizationName: 'Athena',
    name: 'North star',
    description: null,
    summary: null,
    ownerId: null,
    ownerName: null,
    status: 'active',
    priority: 'none',
    updateCadence: 'monthly',
    health: null,
    targetDate: null,
    targetDateResolution: null,
    targetDateFiscalYearStartMonth: null,
    display: {
      subjectType: 'initiative',
      subjectId: '1N1T1AT1VE0000000000000001',
      iconKey: 'target',
      colorKey: 'neutral',
      customColor: null,
      coverImage: null,
      customized: false,
    },
    parentInitiativeId: null,
    parentLinkId: null,
    depth: 1,
    childCount: 0,
    lastUpdateAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as InitiativeOverviewItem;
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof InitiativePropertiesPanel>> = {},
) {
  const callbacks = {
    onStatusChange: vi.fn(),
    onHealthChange: vi.fn(),
    onTargetChange: vi.fn(),
    onOwnerChange: vi.fn(),
    onPriorityChange: vi.fn(),
    onCadenceChange: vi.fn(),
    onLabelsChange: vi.fn(),
  };
  render(
    <InitiativePropertiesPanel
      status="active"
      health={null}
      targetDate={null}
      targetDateResolution={null}
      targetDateFiscalYearStartMonth={null}
      fiscalYearStartMonth={0}
      planningCalendarLoading={false}
      ownerId={null}
      priority="none"
      updateCadence="monthly"
      memberOptions={[]}
      labels={[]}
      availableLabels={[]}
      canEdit
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe('Initiative planning timeframes', () => {
  it('updates a broad target and clears date plus resolution together', () => {
    const callbacks = renderPanel({
      targetDate: '2026-08-31',
      targetDateResolution: 'month',
      targetDateFiscalYearStartMonth: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('option', { name: 'December 2026' }));
    expect(callbacks.onTargetChange).toHaveBeenCalledWith({
      date: '2026-12-31',
      resolution: 'month',
      fiscalYearStartMonth: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(callbacks.onTargetChange).toHaveBeenLastCalledWith(null);
  });

  it('uses a precise day when the specific-date calendar commits', () => {
    const callbacks = renderPanel({
      targetDate: '2026-08-20',
      targetDateResolution: 'month',
      targetDateFiscalYearStartMonth: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Specific date' }));
    fireEvent.click(
      within(screen.getByRole('grid', { name: 'Target date' })).getByRole('button', {
        name: '2026-08-25',
      }),
    );
    expect(callbacks.onTargetChange).toHaveBeenCalledWith({
      date: '2026-08-25',
      resolution: null,
      fiscalYearStartMonth: null,
    });
  });

  it('renders saved fiscal semantics instead of the current workspace basis', () => {
    renderPanel({
      targetDate: '2026-06-30',
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 3,
      fiscalYearStartMonth: 0,
    });

    expect(screen.getByRole('button', { name: /Target date/ })).toHaveTextContent('Q1 FY 2027');
  });

  it('builds semantic labels and only offers timeframes present in the hierarchy', () => {
    const exact = initiative({
      id: '1N1T1AT1VE0000000000000002',
      targetDate: '2026-06-17',
    });
    const quarter = initiative({
      id: '1N1T1AT1VE0000000000000003',
      targetDate: '2026-06-30',
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 3,
    });
    const catalog = buildInitiativeCatalog({ initiatives: [quarter, exact], statuses: [] });
    const timeframe = assertDefined(findField(catalog, 'targetTimeframe'));

    expect(formatInitiativeTarget(quarter)).toBe('Q1 FY 2027');
    expect(initiativeTargetTimeframeKey(quarter)).toBe('2026-06-30|quarter|3');
    expect(optionsFor(timeframe)).toEqual([
      { value: '2026-06-17|day', label: 'Jun 17, 2026' },
      { value: '2026-06-30|quarter|3', label: 'Q1 FY 2027' },
    ]);
  });

  it('formats Project roadmap endpoints from their saved planning metadata', () => {
    expect(formatPlanningDate('2026-04-01', 'quarter', 3)).toBe('Q1 FY 2027');
    expect(formatPlanningDate('2026-12-31', 'month', 0)).toBe('December 2026');
    expect(formatPlanningDate('2026-08-20', null, null)).toBe('Aug 20, 2026');
  });
});
