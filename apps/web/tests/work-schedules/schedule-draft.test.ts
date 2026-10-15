import { describe, expect, it } from 'vitest';
import {
  initialScheduleDraft,
  scheduleCreateInput,
  scheduleTitleExample,
  selectScheduleTemplate,
} from '../../src/components/work-schedules/schedule-draft';
import { scheduleFixture } from './schedule-fixtures';

describe('native schedule authoring', () => {
  it('keeps incomplete work local and starts a latest publication in its owning Program', () => {
    const { template, programId } = scheduleFixture();
    const initial = initialScheduleDraft('2026-10-15', 'America/Los_Angeles');
    expect(scheduleCreateInput(initial, programId)).toBeNull();
    const draft = selectScheduleTemplate(initial, template, programId);
    expect(scheduleCreateInput(draft, programId)).toMatchObject({
      ownerProgramId: programId,
      document: {
        template: { selection: { kind: 'latest' } },
        root: { kind: 'project', placement: { programId } },
      },
    });
  });
  it('preserves exact private choices when editing future runs and gives a civil-date title example', () => {
    const { schedule, programId } = scheduleFixture();
    const draft = initialScheduleDraft('2026-11-01', 'UTC', schedule);
    expect(draft.document).toEqual(schedule.revision.document);
    expect(draft.timezone).toBe('America/Los_Angeles');
    expect(scheduleTitleExample(draft)).toBe('November Dinner');
    expect(scheduleCreateInput(draft, programId)?.trigger).toEqual(schedule.revision.trigger);
    expect(scheduleCreateInput(draft, programId)?.effectiveFrom).toBe('2026-11-01');
  });
  it.each(['2026-10-15', '2026-12-01'])(
    'reopens a revision after its saved %s boundary',
    (effectiveFrom) => {
      const { schedule } = scheduleFixture();
      const current = { ...schedule, revision: { ...schedule.revision, effectiveFrom } };
      expect(initialScheduleDraft('2026-10-15', 'UTC', current).effectiveFrom).toBe(
        effectiveFrom === '2026-10-15' ? '2026-10-16' : '2026-12-02',
      );
    },
  );
  it('rejects invalid date tokens and inconsistent timezone without losing the draft', () => {
    const { schedule, programId } = scheduleFixture();
    const original = initialScheduleDraft('2026-11-01', 'UTC', schedule);
    if (!original.document) throw new Error('Expected a native draft.');
    const draft = {
      ...original,
      document: { ...original.document, titlePattern: '{unsupported} Dinner' },
    };
    expect(scheduleTitleExample(draft)).toBeNull();
    expect(scheduleCreateInput(draft, programId)).toBeNull();
    expect(draft.document.titlePattern).toBe('{unsupported} Dinner');
    expect(
      scheduleCreateInput({ ...original, timezone: 'invalid/timezone' }, programId),
    ).toBeNull();
  });
});
