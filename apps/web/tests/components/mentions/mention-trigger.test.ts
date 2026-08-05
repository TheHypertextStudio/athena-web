import { describe, expect, it } from 'vitest';

import { findMentionTrigger } from '@/components/mentions/mention-trigger';

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

  it('allows a two-word query so a full name can be typed', () => {
    expect(findMentionTrigger('@design review')).toEqual({ start: 0, query: 'design review' });
  });

  it('stays open on the space between two words, or the second word could never be typed', () => {
    expect(findMentionTrigger('@design ')).toEqual({ start: 0, query: 'design ' });
  });

  it('closes once the text stops looking like a name', () => {
    expect(findMentionTrigger('@design review board')).toBeUndefined();
    expect(findMentionTrigger('@design review ')).toBeUndefined();
  });

  it('closes when the attempt runs past any plausible name', () => {
    expect(findMentionTrigger(`@${'a'.repeat(49)}`)).toBeUndefined();
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
