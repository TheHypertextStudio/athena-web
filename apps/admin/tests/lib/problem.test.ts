import { describe, expect, it } from 'vitest';

import {
  isAuthError,
  readProblemError,
  userErrorMessage,
  userProblemMessage,
} from '../../src/lib/problem';

const diagnostic = 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions';

describe('admin user-facing errors', () => {
  it('keeps only response status and code while using caller-owned display copy', async () => {
    const response = new Response(
      JSON.stringify({
        type: 'https://example.com/problems/internal',
        title: diagnostic,
        detail: diagnostic,
        status: 500,
        code: 'internal',
      }),
      { status: 500 },
    );

    const error = await readProblemError(response, 'Could not load the dashboard.');

    expect(error).toMatchObject({
      message: 'Could not load the dashboard.',
      status: 500,
      code: 'internal',
    });
    expect(userErrorMessage(error, 'unused')).not.toContain('AGENT_MAX_TURNS');
  });

  it('discards arbitrary exception messages', () => {
    expect(userErrorMessage(new Error(diagnostic), 'Something went wrong.')).toBe(
      'Something went wrong.',
    );
  });

  it('returns caller-owned copy for malformed response bodies', async () => {
    const response = new Response(diagnostic, { status: 503 });

    await expect(userProblemMessage(response, 'Please try again.')).resolves.toBe(
      'Please try again.',
    );
  });
});

describe('admin problem-code extraction', () => {
  it('keeps the status but no code when the body is JSON that is not a Problem', async () => {
    const response = new Response(JSON.stringify({ error: diagnostic }), { status: 422 });

    const error = await readProblemError(response, 'Could not save the change.');

    expect(error.status).toBe(422);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('Could not save the change.');
  });

  it('retains the original failure as the cause without surfacing it', () => {
    const cause = new Error(diagnostic);

    const error = (() => {
      try {
        throw cause;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(userErrorMessage(error, 'Something went wrong.')).toBe('Something went wrong.');
  });
});

describe('isAuthError', () => {
  it.each([401, 403])('treats %i as an authentication failure', (status) => {
    expect(isAuthError(new Response(null, { status }))).toBe(true);
  });

  it.each([400, 404, 500])('leaves %i for the caller to handle', (status) => {
    expect(isAuthError(new Response(null, { status }))).toBe(false);
  });
});
