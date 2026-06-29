import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import { MockSummarizer } from '../../src/mock/summarizer';
import type { SummarizeInput } from '../../src/ports/summarizer';
import {
  DEFAULT_SUMMARIZER_MODEL,
  RealSummarizer,
  buildRequest,
  extractMarkdown,
} from '../../src/real/summarizer';

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
