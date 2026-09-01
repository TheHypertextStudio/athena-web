/** Project timeline display helpers shared by Project surfaces. */
import type { ProjectOverviewItem } from '../../lib/contracts/project';

import { formatPlanningTimeframe, toPlanningTimeframe } from '@/lib/planning-timeframe';

/** Format a Project timeline span from its saved start and target planning semantics. */
export function formatProjectTimelineSpan(row: ProjectOverviewItem): string | null {
  const start = formatPlanningTimeframe(
    toPlanningTimeframe(row.startDate, row.startDateResolution, row.startDateFiscalYearStartMonth),
  );
  const target = formatPlanningTimeframe(
    toPlanningTimeframe(
      row.targetDate,
      row.targetDateResolution,
      row.targetDateFiscalYearStartMonth,
    ),
  );
  if (start && target) return start === target ? start : `${start} to ${target}`;
  return start ?? target;
}
