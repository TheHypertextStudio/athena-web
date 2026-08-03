import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import { MockTaskSynthesizer } from '../../src/mock-task-synthesizer';
import type { TaskDraftInput } from '../../src/task-synthesizer';
import {
  DEFAULT_SYNTHESIS_MODEL,
  RealTaskSynthesizer,
  buildRequest,
  extractText,
  fallbackDraft,
  parseDraft,
} from '../../src/real-task-synthesizer';

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

  it('falls back to a generic title for a blank subject', async () => {
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: '   ',
      snippet: '',
      sender: 'a@b.c',
    });
    expect(draft.title).toBe('Follow up on an email');
  });

  it('sets dueDate when the snippet contains a literal ISO date', async () => {
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: 'Interview scheduling',
      snippet: 'Please confirm by 2026-07-04, thanks!',
      sender: 'a@b.c',
    });
    expect(draft.dueDate).toBe('2026-07-04');
  });

  it('omits dueDate when the snippet has no literal ISO date', async () => {
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: 'Interview scheduling',
      snippet: 'Let us know your availability soon.',
      sender: 'a@b.c',
    });
    expect(draft.dueDate).toBeUndefined();
  });
});

const CONFIG = { apiKey: 'sk-ant-test' };

const INPUT: TaskDraftInput = {
  subject: 'Software Engineering Interview',
  snippet: 'They proposed three slots next week.',
  sender: 'recruiter@google.com',
};

/** A minimal fake Anthropic message carrying the given text blocks. */
function fakeMessage(...texts: string[]): Message {
  return { content: texts.map((text) => ({ type: 'text', text })) } as unknown as Message;
}

describe('RealTaskSynthesizer buildRequest / extractText', () => {
  it('builds a non-streaming request with the default model and the email signal', () => {
    const req = buildRequest(INPUT, CONFIG);
    expect(req.model).toBe(DEFAULT_SYNTHESIS_MODEL);
    expect(req.max_tokens).toBe(400);
    expect(req.messages[0]?.role).toBe('user');
    const content = req.messages[0]?.content;
    const text = typeof content === 'string' ? content : '';
    expect(text).toContain('Software Engineering Interview');
    expect(text).toContain('recruiter@google.com');
  });

  it('honors a model override from config', () => {
    expect(buildRequest(INPUT, { ...CONFIG, model: 'claude-opus-4-7' }).model).toBe(
      'claude-opus-4-7',
    );
  });

  it('extracts and joins only text blocks', () => {
    const msg = {
      content: [
        { type: 'text', text: '{"title":' },
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '"Schedule it"}' },
      ],
    } as unknown as Message;
    expect(extractText(msg)).toBe('{"title":"Schedule it"}');
  });
});

describe('fallbackDraft', () => {
  it('derives the title from the subject at medium priority with the snippet as description', () => {
    const draft = fallbackDraft(INPUT);
    expect(draft.title).toBe('Software Engineering Interview');
    expect(draft.description).toBe('They proposed three slots next week.');
    expect(draft.priority).toBe('medium');
  });

  it('omits the description when the snippet is blank', () => {
    const draft = fallbackDraft({ ...INPUT, snippet: '   ' });
    expect(draft.description).toBeUndefined();
  });
});

describe('parseDraft', () => {
  it('parses a well-formed reply with every field', () => {
    const draft = parseDraft(
      JSON.stringify({
        title: 'Schedule the SWE interview',
        description: 'Recruiter proposed three slots.',
        priority: 'high',
        dueDate: '2026-07-04',
      }),
    );
    expect(draft).toEqual({
      title: 'Schedule the SWE interview',
      priority: 'high',
      description: 'Recruiter proposed three slots.',
      dueDate: '2026-07-04',
    });
  });

  it('tolerates surrounding prose around the JSON object', () => {
    const draft = parseDraft(
      `Sure, here you go:\n${JSON.stringify({ title: 'Reply to the client', priority: 'low' })}\nLet me know if that helps.`,
    );
    expect(draft?.title).toBe('Reply to the client');
  });

  it('returns null when there is no JSON object at all', () => {
    expect(parseDraft('sorry, I cannot help with that')).toBeNull();
  });

  it('returns null when a stray closing brace precedes any opening brace', () => {
    expect(parseDraft('}garbage{')).toBeNull();
  });

  it('returns null when the braces enclose malformed JSON', () => {
    expect(parseDraft('{not valid json}')).toBeNull();
  });

  it('returns null when the parsed object has no usable title', () => {
    expect(parseDraft(JSON.stringify({ priority: 'high' }))).toBeNull();
    expect(parseDraft(JSON.stringify({ title: '   ', priority: 'high' }))).toBeNull();
    expect(parseDraft(JSON.stringify({ title: 42, priority: 'high' }))).toBeNull();
  });

  it('falls back to medium priority for an invalid or missing priority value', () => {
    expect(
      parseDraft(JSON.stringify({ title: 'Do the thing', priority: 'urgentish' }))?.priority,
    ).toBe('medium');
    expect(parseDraft(JSON.stringify({ title: 'Do the thing' }))?.priority).toBe('medium');
  });

  it('accepts every valid priority literal', () => {
    for (const priority of ['none', 'urgent', 'high', 'medium', 'low']) {
      expect(parseDraft(JSON.stringify({ title: 'x', priority }))?.priority).toBe(priority);
    }
  });

  it('omits description when absent, blank, or non-string', () => {
    expect(parseDraft(JSON.stringify({ title: 'x' }))?.description).toBeUndefined();
    expect(
      parseDraft(JSON.stringify({ title: 'x', description: '   ' }))?.description,
    ).toBeUndefined();
    expect(parseDraft(JSON.stringify({ title: 'x', description: 7 }))?.description).toBeUndefined();
  });

  it('trims a present description', () => {
    expect(
      parseDraft(JSON.stringify({ title: 'x', description: '  why it matters  ' }))?.description,
    ).toBe('why it matters');
  });

  it('omits dueDate when absent or not a strict YYYY-MM-DD string', () => {
    expect(parseDraft(JSON.stringify({ title: 'x' }))?.dueDate).toBeUndefined();
    expect(parseDraft(JSON.stringify({ title: 'x', dueDate: null }))?.dueDate).toBeUndefined();
    expect(
      parseDraft(JSON.stringify({ title: 'x', dueDate: '2026-07-04T00:00:00.000Z' }))?.dueDate,
    ).toBeUndefined();
  });

  it('accepts a literal ISO date the model echoed', () => {
    expect(parseDraft(JSON.stringify({ title: 'x', dueDate: '2026-07-04' }))?.dueDate).toBe(
      '2026-07-04',
    );
  });
});

describe('RealTaskSynthesizer.synthesize', () => {
  it('returns the parsed draft from an injected creator', async () => {
    const synthesizer = new RealTaskSynthesizer(CONFIG, async () =>
      fakeMessage(JSON.stringify({ title: 'Schedule the SWE interview', priority: 'high' })),
    );
    const draft = await synthesizer.synthesize(INPUT);
    expect(draft.title).toBe('Schedule the SWE interview');
    expect(draft.priority).toBe('high');
  });

  it('falls back to a subject-derived draft when the reply cannot be parsed', async () => {
    const synthesizer = new RealTaskSynthesizer(CONFIG, async () => fakeMessage('not json at all'));
    const draft = await synthesizer.synthesize(INPUT);
    expect(draft).toEqual(fallbackDraft(INPUT));
  });

  it('wraps creator errors as a secret-free error', async () => {
    const synthesizer = new RealTaskSynthesizer(CONFIG, async () => {
      throw new Error('network down');
    });
    await expect(synthesizer.synthesize(INPUT)).rejects.toThrow(/task synthesis failed/);
  });

  it('exposes a default SDK-backed creator when none is injected', () => {
    // The default constructs a real client; the live network call itself is the
    // v8-ignored IO edge, so this only proves the seam wires up without a network call.
    expect(() => new RealTaskSynthesizer(CONFIG)).not.toThrow();
  });
});
