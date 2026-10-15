/** Shared inline and overflow navigation for the personal Time review. */
import type { JSX } from 'react';
import type { ResponsiveControlItem } from '@docket/ui/components';
import { Button, DropdownMenuItem } from '@docket/ui/primitives';
import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import {
  adjacentTimeReviewCycle,
  navigateTimeReviewPeriod,
  todayTimeReviewState,
  type TimeReviewCycle,
  type TimeReviewState,
} from './time-review-state';

interface NavigationProps {
  readonly state: TimeReviewState;
  readonly cycles: readonly TimeReviewCycle[];
  readonly timezone: string;
  readonly todayReady: boolean;
  readonly onState: (state: TimeReviewState) => void;
}

function navigationItem({
  id,
  label,
  icon,
  disabled,
  onSelect,
}: {
  readonly id: string;
  readonly label: string;
  readonly icon: JSX.Element | string;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}): ResponsiveControlItem {
  return {
    id,
    priority: 1,
    inline: (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={label}
        disabled={disabled}
        onClick={onSelect}
      >
        {icon}
      </Button>
    ),
    overflow: (
      <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
        {label}
      </DropdownMenuItem>
    ),
  };
}

/** Build period navigation once so both responsive presentations use the same selection and guards. */
export function timeReviewNavigationControls(
  props: NavigationProps,
): readonly ResponsiveControlItem[] {
  const { state, cycles, timezone, onState } = props;
  const directions = [
    { id: 'previous', label: 'Previous', direction: -1, icon: <ChevronLeft aria-hidden="true" /> },
    { id: 'next', label: 'Next', direction: 1, icon: <ChevronRight aria-hidden="true" /> },
  ] as const;
  return [
    ...directions.map(({ id, label, direction, icon }) =>
      navigationItem({
        id,
        label: `${label} ${state.period}`,
        icon,
        disabled:
          state.period === 'cycle' && !adjacentTimeReviewCycle(cycles, state.cycleId, direction),
        onSelect: () => {
          onState(navigateTimeReviewPeriod(state, direction, cycles));
        },
      }),
    ),
    navigationItem({
      id: 'today',
      label: 'Today',
      icon: 'Today',
      disabled: !props.todayReady,
      onSelect: () => {
        onState(todayTimeReviewState(state, timezone, cycles));
      },
    }),
  ];
}
