import { describe, expect, it } from 'vitest';

import { readProblemError, userErrorMessage, userProblemMessage } from '../src/lib/problem';

const diagnostic = 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions';

describe('admin user-facing errors', () => {
  it('keeps only response status and code while using caller-owned display copy', async () => {
    const response = new Response(
      JSON.stringify({
        type: 'https://docket.dev/problems/internal',
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
