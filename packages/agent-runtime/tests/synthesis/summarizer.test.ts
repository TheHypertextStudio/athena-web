import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import { MockSummarizer } from '../../src/mock-summarizer';
import type { SummarizeInput } from '../../src/summarizer';
import {
  DEFAULT_SUMMARIZER_MODEL,
  RealSummarizer,
  buildRequest,
  defaultMessageCreator,
  extractMarkdown,
} from '../../src/real-summarizer';

const CONFIG = { apiKey: 'sk-ant-test' };

const INPUT: SummarizeInput = {
  dateLabel: 'Saturday, June 28, 2026',
  recipientName: 'Willie',
  observations: [
    {
      provider: 'linear',
      kind: 'mention',
      occurredAt: '2026-06-28T09:00:00.000Z',
      title: 'You were mentioned',
      actor: 'Jane',
      subject: 'Ship it',
    },
  ],
};

/** A minimal fake Anthropic message carrying the given text blocks. */
function fakeMessage(...texts: string[]): Message {
  return { content: texts.map((text) => ({ type: 'text', text })) } as unknown as Message;
}

describe('RealSummarizer buildRequest / extractMarkdown', () => {
  it('builds a non-streaming request with the default model and the observations', () => {
    const req = buildRequest(INPUT, CONFIG);
    expect(req.model).toBe(DEFAULT_SUMMARIZER_MODEL);
    expect(req.messages[0]?.role).toBe('user');
    const content = req.messages[0]?.content;
    const text = typeof content === 'string' ? content : '';
    expect(text).toContain('You were mentioned');
    expect(text).toContain('Willie');
  });

  it('omits the "for <name>" clause when no recipientName is given', () => {
    const req = buildRequest({ ...INPUT, recipientName: undefined }, CONFIG);
    const content = req.messages[0]?.content;
    const text = typeof content === 'string' ? content : '';
    expect(text).not.toContain(' for Willie');
    expect(text).toMatch(/for Saturday, June 28, 2026/);
  });

  it('notes "no tracked activity" when there are no observations', () => {
    const req = buildRequest({ ...INPUT, observations: [] }, CONFIG);
    const content = req.messages[0]?.content;
    const text = typeof content === 'string' ? content : '';
    expect(text).toContain('(no tracked activity)');
  });

  it('omits actor/subject metadata when an observation carries neither', () => {
    const req = buildRequest(
      {
        ...INPUT,
        observations: [
          {
            provider: 'gmail',
            kind: 'email',
            occurredAt: '2026-06-28T09:00:00.000Z',
            title: 'Newsletter arrived',
          },
        ],
      },
      CONFIG,
    );
    const content = req.messages[0]?.content;
    const text = typeof content === 'string' ? content : '';
    expect(text).toContain('Newsletter arrived');
    expect(text).not.toContain(' — by ');
    expect(text).not.toContain(' — on ');
    // No summary and no meta means the trailing "— tail" clause is dropped entirely.
    expect(text).not.toMatch(/Newsletter arrived —/);
  });

  it('honors model and maxTokens overrides', () => {
    const req = buildRequest(INPUT, { ...CONFIG, model: 'claude-opus-4-7', maxTokens: 1000 });
    expect(req.model).toBe('claude-opus-4-7');
    expect(req.max_tokens).toBe(1000);
  });

  it('extracts and joins only text blocks', () => {
    const msg = {
      content: [
        { type: 'text', text: '# Digest\n' },
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '- did things' },
      ],
    } as unknown as Message;
    expect(extractMarkdown(msg)).toBe('# Digest\n- did things');
  });
});

describe('RealSummarizer.summarize', () => {
  it('returns markdown from an injected creator', async () => {
    const summarizer = new RealSummarizer(CONFIG, async () => fakeMessage('hello digest'));
    expect((await summarizer.summarize(INPUT)).markdown).toBe('hello digest');
  });

  it('wraps creator errors as a secret-free error', async () => {
    const summarizer = new RealSummarizer(CONFIG, async () => {
      throw new Error('network down');
    });
    await expect(summarizer.summarize(INPUT)).rejects.toThrow(/summarizer failed/);
  });

  it('falls back to the default SDK-backed creator when none is injected', () => {
    // Constructing without a creator must not throw — it should build the default factory
    // (which itself only constructs a client, never makes a network call).
    expect(() => new RealSummarizer(CONFIG)).not.toThrow();
  });

  it('exposes a default SDK-backed creator factory', () => {
    expect(typeof defaultMessageCreator(CONFIG)).toBe('function');
  });
});

describe('MockSummarizer', () => {
  it('renders a deterministic digest listing the observations', async () => {
    const { markdown } = await new MockSummarizer().summarize(INPUT);
    expect(markdown).toContain('Willie');
    expect(markdown).toContain('You were mentioned');
  });

  it('handles an empty day', async () => {
    const { markdown } = await new MockSummarizer().summarize({
      dateLabel: 'Sunday',
      observations: [],
    });
    expect(markdown).toContain('No tracked activity');
  });
});
