import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYNTHESIS_MODEL,
  RealTaskSynthesizer,
  buildRequest,
  extractText,
  fallbackDraft,
  parseDraft,
} from '../src/task-drafting/adapters/anthropic';
import { MockTaskSynthesizer } from '../src/task-drafting/adapters/deterministic';

describe('Athena deterministic task drafting', () => {
  it('derives a stable task draft from one email signal', async () => {
    const draft = await new MockTaskSynthesizer().synthesize({
      subject: 'Software Engineering Interview',
      snippet: 'They proposed three slots next week.',
      sender: 'recruiter@google.com',
    });

    expect(draft).toEqual({
      title: 'Software Engineering Interview',
      description: 'They proposed three slots next week.',
      priority: 'medium',
    });
  });

  it('uses Work title rules and only promotes literal ISO deadlines', async () => {
    const synthesizer = new MockTaskSynthesizer();

    await expect(
      synthesizer.synthesize({
        subject: 'x'.repeat(200),
        snippet: 'Please confirm by 2026-07-04.',
        sender: 'recruiter@google.com',
      }),
    ).resolves.toMatchObject({
      title: `${'x'.repeat(119)}…`,
      dueDate: '2026-07-04',
    });
    const draftWithoutDeadline = await synthesizer.synthesize({
      subject: '   ',
      snippet: 'Soon would be ideal.',
      sender: 'recruiter@google.com',
    });
    expect(draftWithoutDeadline.title).toBe('Follow up on an email');
    expect(draftWithoutDeadline).not.toHaveProperty('dueDate');
  });
});

describe('Athena Anthropic task drafting', () => {
  const input = {
    subject: 'Software Engineering Interview',
    snippet: 'They proposed three slots next week.',
    sender: 'recruiter@google.com',
  };
  const config = { apiKey: 'sk-ant-test' };

  it('builds the model request from an email signal', () => {
    const request = buildRequest(input, config);
    const content = request.messages[0]?.content;

    expect(request.model).toBe(DEFAULT_SYNTHESIS_MODEL);
    expect(request.max_tokens).toBe(400);
    expect(typeof content === 'string' ? content : '').toContain(input.subject);
    expect(typeof content === 'string' ? content : '').toContain(input.sender);
  });

  it('parses valid provider JSON and normalizes malformed values', () => {
    expect(
      parseDraft(
        JSON.stringify({
          title: 'Schedule the SWE interview',
          description: ' Recruiter proposed three slots. ',
          priority: 'high',
          dueDate: '2026-07-04',
        }),
      ),
    ).toEqual({
      title: 'Schedule the SWE interview',
      description: 'Recruiter proposed three slots.',
      priority: 'high',
      dueDate: '2026-07-04',
    });
    expect(parseDraft(JSON.stringify({ title: 'Reply to them', priority: 'unknown' }))).toEqual({
      title: 'Reply to them',
      priority: 'medium',
    });
    expect(parseDraft('not JSON')).toBeNull();
  });

  it('keeps only valid optional fields from a provider reply', () => {
    expect(
      parseDraft(
        JSON.stringify({
          title: 'Reply to them',
          description: '   ',
          priority: 'urgent',
          dueDate: '2026-07-04T00:00:00.000Z',
        }),
      ),
    ).toEqual({ title: 'Reply to them', priority: 'urgent' });
    expect(parseDraft(JSON.stringify({ title: '  ' }))).toBeNull();
  });

  it('joins only text blocks from a provider response', () => {
    expect(
      extractText({
        content: [
          { type: 'text', text: '{"title":' },
          { type: 'thinking', thinking: 'ignore this' },
          { type: 'text', text: '"Schedule it"}' },
        ],
      } as unknown as Message),
    ).toBe('{"title":"Schedule it"}');
  });

  it('uses a deterministic Work draft when provider output cannot be parsed', async () => {
    const synthesizer = new RealTaskSynthesizer(config, async () =>
      fakeMessage('Provider did not return JSON'),
    );

    await expect(synthesizer.synthesize(input)).resolves.toEqual(fallbackDraft(input));
  });

  it('wraps provider failures under an operation-specific, secret-free error', async () => {
    const synthesizer = new RealTaskSynthesizer(config, async () => {
      throw new Error('network unavailable');
    });

    await expect(synthesizer.synthesize(input)).rejects.toThrow(
      'Anthropic task synthesis failed: network unavailable',
    );
  });
});

function fakeMessage(text: string): Message {
  return { content: [{ type: 'text', text }] } as unknown as Message;
}
