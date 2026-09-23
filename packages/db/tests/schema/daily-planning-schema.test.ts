import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { dailyPlanDay, dailyPlanReview } from '../../src/schema';

describe('daily planning storage', () => {
  it('keeps one draft per day and one decision per unfinished item', () => {
    const day = getTableConfig(dailyPlanDay);
    const review = getTableConfig(dailyPlanReview);

    expect(day.indexes.map((index) => index.config.name)).toContain('daily_plan_day_hub_date_uq');
    expect(review.indexes.map((index) => index.config.name)).toContain(
      'daily_plan_review_source_uq',
    );
    expect(day.foreignKeys.map((key) => getTableConfig(key.reference().foreignTable).name)).toEqual(
      ['hub'],
    );
    expect(
      review.foreignKeys.map((key) => getTableConfig(key.reference().foreignTable).name),
    ).toEqual(['hub', 'daily_plan_item']);
    expect(
      day.columns.find((column) => column.name === 'updated_at')?.onUpdateFn?.(),
    ).toBeInstanceOf(Date);
  });
});
