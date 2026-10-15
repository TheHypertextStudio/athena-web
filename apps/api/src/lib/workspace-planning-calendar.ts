import { organization } from '@docket/db';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { planningDatePatch, type PlanningDateInput } from './planning-timeframe';
import type { TemplateTransaction } from './templates/persistence';

/** Read the workspace's current fiscal boundary within an ordinary planning mutation. */
export async function workspacePlanningCalendar(
  tx: TemplateTransaction,
  orgId: string,
): Promise<{ readonly fiscalYearStartMonth: number }> {
  const [settings] = await tx
    .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!settings) throw new NotFoundError('Organization not found');
  return settings;
}

/** Normalize the target-date columns together, retaining the workspace's saved fiscal basis. */
export function workspaceTargetDatePatch(input: PlanningDateInput, fiscalYearStartMonth: number) {
  const target = planningDatePatch(
    input,
    fiscalYearStartMonth,
    'target',
    'targetDate',
    'targetDateResolution',
  );
  return target === undefined
    ? {}
    : {
        targetDate: target.date,
        targetDateResolution: target.resolution,
        targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
      };
}
