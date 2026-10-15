import { describe, expect, it } from 'vitest';
import { nextWorkTitleForDate } from '../../src/lib/recurrence/schedule-next-work';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { ulid } from './work-schedule-fixture';
const document = WorkScheduleDraft.parse({
  kind: 'schedule',
  revision: 1,
  template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
  titlePattern: '{month} Gathering',
  timezone: 'UTC',
  root: { kind: 'project', fields: {}, dates: {}, placement: {} },
  stepOverrides: [],
  optionalChoices: [],
});
describe('next scheduled work title', () => {
  it('preserves an actual upcoming title across pattern edits and calendar moves', () => {
    expect(
      nextWorkTitleForDate(document, '2026-11-20', { title: 'November Dinner — venue confirmed' }),
    ).toBe('November Dinner — venue confirmed');
  });
  it('does not replace a hidden or deleted actual work title with a prospective pattern', () => {
    expect(nextWorkTitleForDate(document, '2026-11-20', { title: null })).toBeNull();
  });
  it('renders prospective work from the governing saved revision at its actual civil date', () => {
    expect(nextWorkTitleForDate(document, '2026-11-20', null)).toBe('November Gathering');
    expect(nextWorkTitleForDate(null, '2026-11-20', null)).toBeNull();
  });
});
