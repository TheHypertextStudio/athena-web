import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Priority } from '../src/task-contract';
import type { TaskDraft, TaskDraftInput, TaskSynthesizer } from '../src/task-drafting';

const EMAIL_INPUT: TaskDraftInput = {
  subject: 'Software Engineering Interview',
  snippet: 'They proposed three slots next week.',
  sender: 'recruiter@google.com',
};

const draft: TaskDraft = {
  title: 'Schedule the SWE interview',
  description: 'Recruiter proposed three slots.',
  priority: 'high',
  dueDate: '2026-07-04',
};

const synthesizer: TaskSynthesizer = {
  async synthesize(input) {
    return { ...draft, title: `${draft.title}: ${input.subject}` };
  },
};

describe('TaskDrafting contracts', () => {
  it('models one email signal and the task draft a synthesizer returns', async () => {
    const result = await synthesizer.synthesize(EMAIL_INPUT);

    expect(result).toMatchObject({
      title: 'Schedule the SWE interview: Software Engineering Interview',
      description: 'Recruiter proposed three slots.',
      priority: 'high',
      dueDate: '2026-07-04',
    });
  });

  it('uses the Work priority vocabulary for a task draft', () => {
    expectTypeOf<TaskDraft['priority']>().toEqualTypeOf<Priority>();
  });
});
