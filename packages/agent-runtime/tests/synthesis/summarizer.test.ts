import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import { MockSummarizer } from '../../src/mock-summarizer';
import type { NarrateDayInput, NarrationEpisode } from '../../src/summarizer';
import {
  DEFAULT_SUMMARIZER_MODEL,
  RealSummarizer,
  buildRequest,
  defaultMessageCreator,
  extractText,
  fallbackSentence,
  parseHighlights,
  reconcileHighlights,
} from '../../src/real-summarizer';

const CONFIG = { apiKey: 'sk-ant-test' };

function episode(key: string, over: Partial<NarrationEpisode> = {}): NarrationEpisode {
  return {
    key,
    provider: 'github',
    subject: 'Ship the beta',
    startedAt: '2026-08-12T09:00:00.000Z',
    endedAt: '2026-08-12T09:30:00.000Z',
    events: [
      {
        kind: 'completed',
        occurredAt: '2026-08-12T09:30:00.000Z',
        title: 'Ship the beta',
        summary: 'Merged after review',
      },
    ],
    ...over,
  };
}

const INPUT: NarrateDayInput = {
  dateLabel: 'Wednesday, August 12, 2026',
  recipientName: 'Willie',
  episodes: [episode('ep-a'), episode('ep-b', { provider: 'gmail', subject: 'Re: transit' })],
};

/** The user turn's text, narrowed from the union the SDK allows. */
function userText(req: MessageCreateParamsNonStreaming): string {
  const content = req.messages[0]?.content;
  return typeof content === 'string' ? content : '';
}

/** A minimal fake Anthropic message carrying the given text blocks. */
function fakeMessage(...texts: string[]): Message {
  return { content: texts.map((text) => ({ type: 'text', text })) } as unknown as Message;
}

/** A well-formed reply naming each supplied key. */
function replyFor(...pairs: [string, string][]): Message {
  return fakeMessage(
    JSON.stringify({ highlights: pairs.map(([key, sentence]) => ({ key, sentence })) }),
  );
}

describe('buildRequest', () => {
  it('asks one non-streaming call for every episode, keys included', () => {
    const req = buildRequest(INPUT, CONFIG);

    expect(req.model).toBe(DEFAULT_SUMMARIZER_MODEL);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]?.role).toBe('user');
    const text = userText(req);
    for (const ep of INPUT.episodes) expect(text).toContain(ep.key);
    expect(text).toContain(INPUT.dateLabel);
    // The count is stated so a truncated reply is detectable as a shortfall rather than accepted.
    expect(text).toContain('2 episodes');
  });

  it('carries the events of each episode and honours a config override', () => {
    const req = buildRequest(INPUT, { ...CONFIG, model: 'claude-test', maxTokens: 99 });

    expect(req.model).toBe('claude-test');
    expect(req.max_tokens).toBe(99);
    expect(userText(req)).toContain('Merged after review');
  });

  it('still builds a request for a day with no episodes', () => {
    const req = buildRequest({ dateLabel: 'Today', episodes: [] }, CONFIG);
    expect(userText(req)).toContain('no activity');
  });
});

describe('extractText', () => {
  it('joins text blocks and ignores non-text content', () => {
    const message = {
      content: [
        { type: 'text', text: 'a' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: 'b' },
      ],
    } as unknown as Message;
    expect(extractText(message)).toBe('ab');
  });
});

describe('parseHighlights', () => {
  it('reads sentences keyed by episode, tolerating prose around the JSON', () => {
    const parsed = parseHighlights(
      `Sure! {"highlights":[{"key":"ep-a","sentence":"I shipped it."}]} Hope that helps.`,
    );
    expect(parsed.get('ep-a')).toBe('I shipped it.');
  });

  it('returns nothing for a reply it cannot read', () => {
    expect(parseHighlights('no json here').size).toBe(0);
    expect(parseHighlights('{ not valid json').size).toBe(0);
    expect(parseHighlights('{"highlights":"not an array"}').size).toBe(0);
  });

  it('ignores malformed entries and blank sentences', () => {
    const parsed = parseHighlights(
      JSON.stringify({
        highlights: [
          null,
          'a string',
          { key: 'ep-a' },
          { sentence: 'orphan' },
          { key: 'ep-b', sentence: '   ' },
          { key: 'ep-c', sentence: ' I wrote back. ' },
        ],
      }),
    );
    expect([...parsed.keys()]).toEqual(['ep-c']);
    expect(parsed.get('ep-c')).toBe('I wrote back.');
  });

  it('keeps the first sentence when a key is repeated', () => {
    const parsed = parseHighlights(
      JSON.stringify({
        highlights: [
          { key: 'ep-a', sentence: 'first' },
          { key: 'ep-a', sentence: 'second' },
        ],
      }),
    );
    expect(parsed.get('ep-a')).toBe('first');
  });
});

describe('fallbackSentence', () => {
  it('describes the episode in the first person from its own values', () => {
    const sentence = fallbackSentence(episode('ep-a'));
    expect(sentence.startsWith('I ')).toBe(true);
    expect(sentence).toContain('Ship the beta');
  });

  it('counts a multi-event episode rather than describing only its first event', () => {
    const many = episode('ep-a', {
      events: [
        { kind: 'created', occurredAt: '2026-08-12T09:00:00.000Z', title: 'a' },
        { kind: 'completed', occurredAt: '2026-08-12T09:10:00.000Z', title: 'b' },
      ],
    });
    expect(fallbackSentence(many)).toContain('2 updates');
  });

  it('still says something for an unknown kind or a subject-less episode', () => {
    const odd = episode('ep-a', {
      subject: undefined,
      events: [{ kind: 'something_new', occurredAt: '2026-08-12T09:00:00.000Z', title: 'A thing' }],
    });
    expect(fallbackSentence(odd)).toContain('A thing');

    const bare = episode('ep-b', { subject: undefined, events: [] });
    expect(fallbackSentence(bare).length).toBeGreaterThan(0);
  });
});

describe('reconcileHighlights', () => {
  it('returns one entry per episode, in input order, when the model cooperates', () => {
    const out = reconcileHighlights(
      INPUT,
      parseHighlights(
        JSON.stringify({
          highlights: [
            { key: 'ep-b', sentence: 'I replied.' },
            { key: 'ep-a', sentence: 'I shipped.' },
          ],
        }),
      ),
    );
    expect(out.map((h) => h.key)).toEqual(['ep-a', 'ep-b']);
    expect(out.map((h) => h.sentence)).toEqual(['I shipped.', 'I replied.']);
  });

  it.each([
    ['nothing', new Map<string, string>()],
    ['a subset', new Map([['ep-a', 'I shipped.']])],
  ])('fills every gap when the model returns %s', (_label, parsed) => {
    const out = reconcileHighlights(INPUT, parsed);

    expect(out).toHaveLength(INPUT.episodes.length);
    expect(out.map((h) => h.key)).toEqual(['ep-a', 'ep-b']);
    expect(out.every((h) => h.sentence.length > 0)).toBe(true);
  });

  it('ignores keys nobody asked about, so a day cannot gain episodes', () => {
    const out = reconcileHighlights(
      INPUT,
      new Map([
        ['ep-a', 'I shipped.'],
        ['ep-invented', 'I did something nobody recorded.'],
      ]),
    );
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.key)).toEqual(['ep-a', 'ep-b']);
  });
});

describe('RealSummarizer.narrateDay', () => {
  it('narrates each episode from one call', async () => {
    let calls = 0;
    const summarizer = new RealSummarizer(CONFIG, (params) => {
      calls += 1;
      expect(params.stream).toBeUndefined();
      return Promise.resolve(replyFor(['ep-a', 'I shipped it.'], ['ep-b', 'I replied.']));
    });

    const { highlights } = await summarizer.narrateDay(INPUT);

    expect(calls).toBe(1);
    expect(highlights.map((h) => h.sentence)).toEqual(['I shipped it.', 'I replied.']);
  });

  it('never calls the model for a day with no episodes', async () => {
    let calls = 0;
    const summarizer = new RealSummarizer(CONFIG, () => {
      calls += 1;
      return Promise.resolve(fakeMessage('{}'));
    });

    const { highlights } = await summarizer.narrateDay({ dateLabel: 'Today', episodes: [] });

    expect(calls).toBe(0);
    expect(highlights).toEqual([]);
  });

  it('degrades a garbled reply to one line per episode rather than losing the day', async () => {
    const summarizer = new RealSummarizer(CONFIG, () =>
      Promise.resolve(fakeMessage('I could not comply.')),
    );

    const { highlights } = await summarizer.narrateDay(INPUT);

    expect(highlights.map((h) => h.key)).toEqual(['ep-a', 'ep-b']);
    expect(highlights.every((h) => h.sentence.startsWith('I '))).toBe(true);
  });

  it('wraps a transport failure rather than leaking it', async () => {
    const summarizer = new RealSummarizer(CONFIG, () =>
      Promise.reject(new Error('socket hang up')),
    );
    await expect(summarizer.narrateDay(INPUT)).rejects.toBeInstanceOf(Error);
  });

  it('builds a live message creator without issuing a request', () => {
    expect(typeof defaultMessageCreator(CONFIG)).toBe('function');
  });
});

describe('MockSummarizer', () => {
  it('narrates every episode deterministically and in order', async () => {
    const first = await new MockSummarizer().narrateDay(INPUT);
    const second = await new MockSummarizer().narrateDay(INPUT);

    expect(first.highlights.map((h) => h.key)).toEqual(['ep-a', 'ep-b']);
    expect(first.highlights.every((h) => h.sentence.length > 0)).toBe(true);
    // Determinism is the whole reason it exists: two runs must be byte-identical.
    expect(second).toEqual(first);
  });

  it('returns nothing for a day with no episodes', async () => {
    const { highlights } = await new MockSummarizer().narrateDay({
      dateLabel: 'Today',
      episodes: [],
    });
    expect(highlights).toEqual([]);
  });
});
