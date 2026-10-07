/** Optional Athena assessment, mounted beside deterministic daily-plan operations. */
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import {
  dailyPlanAssessmentInput,
  dailyPlanAssessmentOut,
} from '../contracts/daily-plan-assessment';
import { AuthError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { assertProductCapability } from '../product-capability';
import { assessDailyPlan, unavailableDailyAssessment } from '../services/daily-plan-assessment';
import { loadDailyAssessmentContext } from '../services/daily-plan-assessment-context';
import { dayParam } from './daily-plan-day-read';
import { resolveOwnerBackend } from './lattice-backend';

/** Review visible reference data with the person's chosen runtime, without changing any record. */
const dailyPlanAssessment = new Hono<AppEnv>().post(
  '/day/:date/assessment',
  apiDoc({
    tag: 'DailyPlan',
    summary: 'Request an optional Athena assessment of a daily proposal',
    response: dailyPlanAssessmentOut,
    description:
      'Run one structured, read-only turn on the caller-selected Athena backend. Return the proposal fingerprint with a short note and explicit missing-task suggestions. Unavailable models return no assessment and never block manual planning.',
  }),
  zParam(dayParam),
  zJson(dailyPlanAssessmentInput),
  async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { date } = c.req.valid('param');
    const { draft, proposalFingerprint } = c.req.valid('json');
    if (draft.date !== date)
      throw new ValidationError([
        { path: ['draft', 'date'], message: 'Draft date must match the requested day' },
      ]);
    const context = await loadDailyAssessmentContext(session.user.id, draft);
    try {
      const organizations = new Set(
        [...context.tasks, ...context.projects].map((item) => item.organizationId),
      );
      for (const organizationId of organizations)
        await assertProductCapability(organizationId, 'athena');
      const backend = await resolveOwnerBackend(session.user.id);
      return ok(
        c,
        dailyPlanAssessmentOut,
        await assessDailyPlan(backend.runtime, context, proposalFingerprint),
      );
    } catch {
      return ok(c, dailyPlanAssessmentOut, unavailableDailyAssessment(proposalFingerprint));
    }
  },
);

export default dailyPlanAssessment;
