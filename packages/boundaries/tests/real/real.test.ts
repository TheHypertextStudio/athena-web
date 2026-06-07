import { afterEach, describe, expect, it } from 'vitest';

import { defaultHttpClient, type HttpClient } from '../../src/real/http';
import { RealMailer } from '../../src/real/mailer';

/** One recorded HTTP call: the URL and the (optional) request init. */
interface RecordedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/** A fake {@link HttpClient} that records calls and returns scripted responses. */
function fakeHttp(responses: Response[] | ((call: RecordedCall) => Response)): {
  http: HttpClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const http: HttpClient = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (typeof responses === 'function') return responses({ url, ...(init ? { init } : {}) });
    const res = responses[index];
    index += 1;
    if (!res) throw new Error(`fakeHttp: no scripted response for call #${index}`);
    return res;
  };
  return { http, calls };
}

/** Read a recorded request body that is known to be a string. */
function bodyText(call: RecordedCall): string {
  return call.init?.body as string;
}

/** Read one header value off a recorded request's headers record. */
function header(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string>)[name];
}

describe('RealMailer', () => {
  it('posts a message merged with the from-address', async () => {
    const { http, calls } = fakeHttp([new Response(null, { status: 202 })]);
    const mailer = new RealMailer(
      { endpoint: 'https://mail', apiKey: 'k', from: 'no-reply@docket.dev' },
      http,
    );
    await mailer.send({ to: 'a@b.com', subject: 'Hi', text: 'body', html: '<p>body</p>' });
    const call = calls[0]!;
    expect(call.url).toBe('https://mail');
    expect(call.init?.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer k');
    expect(header(call, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(bodyText(call))).toEqual({
      from: 'no-reply@docket.dev',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
    });
  });

  it('throws when the provider rejects the send', async () => {
    const { http } = fakeHttp([new Response('bad', { status: 400 })]);
    const mailer = new RealMailer(
      { endpoint: 'https://mail', apiKey: 'k', from: 'f@docket.dev' },
      http,
    );
    await expect(mailer.send({ to: 'a@b.com', subject: 'S', text: 'b' })).rejects.toThrow(
      /RealMailer send failed: 400/,
    );
  });
});

describe('defaultHttpClient', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('delegates to globalThis.fetch when present', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const res = await defaultHttpClient('https://x', { method: 'GET' });
    expect(await res.text()).toBe('ok');
    expect(calls[0]?.input).toBe('https://x');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('throws when no global fetch is available', () => {
    // @ts-expect-error — deliberately removing fetch to hit the guard.
    globalThis.fetch = undefined;
    expect(() => defaultHttpClient('https://x')).toThrow(/No global fetch available/);
  });
});
