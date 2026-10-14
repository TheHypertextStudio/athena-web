/**
 * The static property rows an Initiative prints.
 *
 * @remarks
 * A printed brief has no pickers, so every value resolves to its final string here — an em dash
 * where the record holds nothing. Kept out of the detail route because it is a pure projection of
 * the document and reads as one, rather than as more of the page's JSX.
 */
import type { InitiativeDetail } from '@docket/work/initiative-contract';
import type { LabelOut } from '@docket/work/label-contract';
import type { DetailPrintProperty } from '@/components/views/detail-print-summary';

import { INITIATIVE_CADENCE_LABEL } from '@/components/initiatives/properties-panel';
import { INITIATIVE_PRIORITY_LABEL } from '@/components/initiatives/priority';
import { formatPlanningTimeframe, toPlanningTimeframe } from '@/lib/planning-timeframe';

/** The em dash a printed brief uses wherever the record holds nothing. */
const ABSENT = '—';

/** What {@link initiativePrintProperties} reads beyond the document itself. */
export interface InitiativePrintContext {
  /** The workspace's own name for this Initiative's status. */
  readonly statusName: string;
  /** The owner's display name, already resolved. */
  readonly ownerName: string;
  /** The Initiative's assigned labels. */
  readonly labels: readonly LabelOut[];
}

/** One health verdict as a printed phrase. */
function healthValue(health: string | null | undefined): string {
  if (!health) return ABSENT;
  return health.replace('_', ' ');
}

/**
 * Project one Initiative into its printed property rows.
 *
 * @param detail - The Initiative document.
 * @param context - See {@link InitiativePrintContext}.
 * @returns the rows, in print order.
 */
export function initiativePrintProperties(
  detail: InitiativeDetail,
  context: InitiativePrintContext,
): readonly DetailPrintProperty[] {
  const target = formatPlanningTimeframe(
    toPlanningTimeframe(
      detail.targetDate,
      detail.targetDateResolution,
      detail.targetDateFiscalYearStartMonth,
    ),
  );
  const labels = context.labels.map((label) => label.name).join(', ');

  return [
    { label: 'Status', value: context.statusName },
    { label: 'Initiative health', value: healthValue(detail.health) },
    { label: 'Connected-work health', value: healthValue(detail.rolledUpHealth) },
    { label: 'Priority', value: INITIATIVE_PRIORITY_LABEL[detail.priority] },
    { label: 'Owner', value: context.ownerName },
    { label: 'Target', value: target ?? ABSENT },
    { label: 'Update cadence', value: INITIATIVE_CADENCE_LABEL[detail.updateCadence] },
    { label: 'Labels', value: labels.length > 0 ? labels : ABSENT },
  ];
}
