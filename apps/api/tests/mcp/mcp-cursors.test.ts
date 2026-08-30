/** Behavioral coverage for signed MCP cursor failure boundaries. */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCursorCodec } from '../../src/mcp/cursors';

const originalSecret = process.env['BETTER_AUTH_SECRET'];

afterEach(() => {
  if (originalSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = originalSecret;
});

function codec() {
  return createCursorCodec({
    payloadSchema: z.object({ after: z.string() }),
    invalidCursorError: () => new Error('invalid cursor'),
    secretMissingError: () => new Error('missing cursor secret'),
  });
}

describe('MCP signed cursors', () => {
  it('fails closed when the signing secret is absent', () => {
    delete process.env['BETTER_AUTH_SECRET'];
    expect(() => codec().encode({ after: 'task-1' })).toThrow('missing cursor secret');
  });

  it('rejects a same-length signature tamper through constant-time comparison', () => {
    process.env['BETTER_AUTH_SECRET'] = 'cursor-test-secret';
    const signed = codec().encode({ after: 'task-1' });
    const envelope = JSON.parse(Buffer.from(signed, 'base64url').toString('utf8')) as {
      payload: { after: string };
      sig: string;
    };
    envelope.sig = `${envelope.sig.startsWith('a') ? 'b' : 'a'}${envelope.sig.slice(1)}`;
    const tampered = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');

    expect(() => codec().decode(tampered)).toThrow('invalid cursor');
  });
});
