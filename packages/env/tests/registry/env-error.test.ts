/**
 * Tests for the message a misconfigured deployment actually reads.
 *
 * @remarks
 * This is failure-path code, so it only ever runs when something is already wrong — which is
 * precisely when a `[object Object]` in place of a variable name costs an operator the hour the
 * message was written to save.
 */
import type { StandardSchemaV1 } from '@t3-oss/env-core';
import { describe, expect, it } from 'vitest';

import { issueVarName, reportInvalidEnv } from '../../src/env-error';

/** Build an issue with the given path, in either Standard Schema segment form. */
function issue(path: StandardSchemaV1.Issue['path'], message = 'Required'): StandardSchemaV1.Issue {
  return { message, path };
}

describe('issueVarName', () => {
  it('reads a bare key path segment', () => {
    expect(issueVarName(issue(['DATABASE_URL']))).toBe('DATABASE_URL');
  });

  it('reads the object form of a path segment', () => {
    // Standard Schema permits `{ key }` wrappers, and which form arrives depends on the
    // validation library — handling only the bare form would print `[object Object]`.
    expect(issueVarName(issue([{ key: 'BETTER_AUTH_SECRET' }]))).toBe('BETTER_AUTH_SECRET');
  });

  it('falls back to a placeholder when the issue carries no path', () => {
    expect(issueVarName(issue([]))).toBe('(unknown)');
    expect(issueVarName(issue(undefined))).toBe('(unknown)');
  });
});

describe('reportInvalidEnv', () => {
  it('names every offending variable and the file to fix', () => {
    const run = (): never =>
      reportInvalidEnv([issue(['API_URL']), issue([{ key: 'CRON_SECRET' }], 'Too small')]);

    expect(run).toThrow(/- API_URL: Required/);
    expect(run).toThrow(/- CRON_SECRET: Too small/);
    expect(run).toThrow(/\.env\.local/);
    expect(run).toThrow(/\.env\.example/);
  });

  it('warns that only the API dies, so the symptom is misleading', () => {
    // The whole reason this handler exists: the web app keeps serving 200, so the first thing a
    // developer sees is a 502 from `/api/auth/get-session` and they debug auth for ten minutes.
    expect(() => reportInvalidEnv([issue(['APP_MODE'])])).toThrow(/not an auth bug/);
  });
});
