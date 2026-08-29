import { describe, expect, it } from 'vitest';

import { decideTrigger, findMentionTrigger } from '@/components/mentions/mention-trigger';

describe('findMentionTrigger', () => {
  it('opens at the start of a block', () => {
    expect(findMentionTrigger('@')).toEqual({ start: 0, query: '' });
    expect(findMentionTrigger('@dri')).toEqual({ start: 0, query: 'dri' });
  });

  it('opens after whitespace and after opening brackets', () => {
    expect(findMentionTrigger('Blocked by @dri')).toEqual({ start: 11, query: 'dri' });
    expect(findMentionTrigger('(@dri')).toEqual({ start: 1, query: 'dri' });
    expect(findMentionTrigger('see "@dri')).toEqual({ start: 5, query: 'dri' });
  });

  it('never opens inside an email address', () => {
    expect(findMentionTrigger('mail me@example.com')).toBeUndefined();
    expect(findMentionTrigger('willie@')).toBeUndefined();
  });

  it('keeps a full multiword entity name open', () => {
    expect(findMentionTrigger('@Zephyr rollout checklist')).toEqual({
      start: 0,
      query: 'Zephyr rollout checklist',
    });
  });

  it('keeps a trailing space open while the next search term is being typed', () => {
    expect(findMentionTrigger('@Zephyr rollout ')).toEqual({
      start: 0,
      query: 'Zephyr rollout ',
    });
  });

  it('uses the API query limit rather than a shorter client-only cutoff', () => {
    expect(findMentionTrigger(`@${'a'.repeat(128)}`)).toEqual({
      start: 0,
      query: 'a'.repeat(128),
    });
    expect(findMentionTrigger(`@${'a'.repeat(129)}`)).toBeUndefined();
  });

  it('closes across a line break', () => {
    expect(findMentionTrigger('@dri\nmore')).toBeUndefined();
  });

  it('tracks the most recent attempt when there are several', () => {
    expect(findMentionTrigger('@one and @two')).toEqual({ start: 9, query: 'two' });
  });

  it('reports nothing when there is no @ at all', () => {
    expect(findMentionTrigger('just some prose')).toBeUndefined();
  });
});

describe('decideTrigger', () => {
  it('offsets the trigger by the origin, so a surface can scan one line of many', () => {
    expect(
      decideTrigger({ textBeforeCaret: 'Blocked by @dri', origin: 40, dismissedStart: undefined }),
    ).toEqual({ kind: 'open', trigger: { start: 51, query: 'dri' } });
  });

  it('keeps a dismissed attempt shut, so Escape survives the keyup that follows it', () => {
    expect(
      decideTrigger({ textBeforeCaret: 'Blocked by @dri', origin: 0, dismissedStart: 11 }),
    ).toEqual({ kind: 'suppressed' });
  });

  it('keeps it shut as more of the same word is typed', () => {
    expect(
      decideTrigger({ textBeforeCaret: 'Blocked by @drive', origin: 0, dismissedStart: 11 }),
    ).toEqual({ kind: 'suppressed' });
  });

  it('opens for a new attempt elsewhere, so one Escape does not disable the feature', () => {
    expect(
      decideTrigger({ textBeforeCaret: '@dri and @pla', origin: 0, dismissedStart: 0 }),
    ).toEqual({ kind: 'open', trigger: { start: 9, query: 'pla' } });
  });

  it('reports nothing once the caret leaves the attempt, which expires the dismissal', () => {
    expect(
      decideTrigger({ textBeforeCaret: 'Blocked by nobody', origin: 0, dismissedStart: 11 }),
    ).toEqual({ kind: 'none' });
  });
});
