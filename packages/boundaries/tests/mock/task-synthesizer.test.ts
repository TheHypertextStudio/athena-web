import { describe, expect, it } from 'vitest';

import { MockTaskSynthesizer } from '../../src/mock/task-synthesizer';
import { selectAdapter } from '../../src/select';

describe('MockTaskSynthesizer', () => {
  it('drafts a deterministic title/description/priority from the email signal', async () => {
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: 'Software Engineering Interview',
      snippet: 'They proposed three slots next week.',
      sender: 'recruiter@google.com',
    });
    expect(draft.title).toBe('Software Engineering Interview');
    expect(draft.description).toBe('They proposed three slots next week.');
    expect(draft.priority).toBe('medium');
  });

  it('caps a long subject title with an ellipsis', async () => {
    const long = 'x'.repeat(200);
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: long,
      snippet: '',
      sender: 'a@b.c',
    });
    expect(draft.title.length).toBeLessThanOrEqual(120);
    expect(draft.title.endsWith('…')).toBe(true);
  });
});

describe('selectAdapter taskSynthesizer', () => {
  it('resolves the mock in test mode (no real key)', () => {
    const adapter = selectAdapter('taskSynthesizer', { APP_MODE: 'test' }, {});
    expect(adapter).toBeInstanceOf(MockTaskSynthesizer);
  });
});
