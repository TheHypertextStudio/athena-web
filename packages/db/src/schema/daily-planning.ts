/** Durable daily planning drafts and accepted commitments. */
import type { AcceptedDailyPlan, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { date, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { hub } from './identity';

/** One person's editable draft and immutable accepted history for a calendar day. */
export const dailyPlanDay = pgTable(
  'daily_plan_day',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    draft: jsonb('draft').$type<DailyPlanSnapshot>(),
    accepted: jsonb('accepted').$type<AcceptedDailyPlan>(),
    resumeStep: text('resume_step').notNull().default('review_yesterday'),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('daily_plan_day_hub_date_uq').on(table.hubId, table.date)],
);
