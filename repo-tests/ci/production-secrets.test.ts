import { describe, expect, it } from 'vitest';

import {
  parseSecretBindings,
  requiredProductionSecretEnvNames,
  validateSecretBindings,
  type SecretBinding,
} from '../../scripts/production-secrets';

describe('parseSecretBindings', () => {
  it('parses one binding per line, trimming and skipping blanks', () => {
    const raw =
      '\n  DATABASE_URL=docket-database-url:latest  \n\nCRON_SECRET=docket-cron-secret:latest\n';
    expect(parseSecretBindings(raw)).toEqual([
      { envName: 'DATABASE_URL', secretName: 'docket-database-url', version: 'latest' },
      { envName: 'CRON_SECRET', secretName: 'docket-cron-secret', version: 'latest' },
    ]);
  });

  it("normalizes zsh's literal newline spelling from a pasted multiline value", () => {
    // A GitHub environment variable edited by pasting through a zsh prompt can retain the shell's
    // literal `$'\n'` spelling instead of a real line break — this is exactly what took the
    // production deploy gate down once: the raw value looked like one unbroken line ending in
    // `...latest$'\n'LINEAR_AGENT_CLIENT_ID=...`, which failed to split into individual bindings.
    const raw =
      "DATABASE_URL=docket-database-url:latest$'\\n'CRON_SECRET=docket-cron-secret:latest";
    expect(parseSecretBindings(raw)).toEqual([
      { envName: 'DATABASE_URL', secretName: 'docket-database-url', version: 'latest' },
      { envName: 'CRON_SECRET', secretName: 'docket-cron-secret', version: 'latest' },
    ]);
  });

  it('names the offending line when a binding has no env=secret separator', () => {
    expect(() => parseSecretBindings('not-a-binding')).toThrow(/invalid secret binding format/);
    expect(() => parseSecretBindings('not-a-binding')).toThrow(/"not-a-binding"/);
  });

  it('names the offending line when a binding has no secret:version separator', () => {
    expect(() => parseSecretBindings('DATABASE_URL=docket-database-url')).toThrow(
      /invalid secret binding format/,
    );
  });

  it('rejects an env name that is not SCREAMING_SNAKE_CASE, naming the line', () => {
    expect(() => parseSecretBindings('database_url=docket-database-url:latest')).toThrow(
      /invalid secret binding name/,
    );
  });

  it('rejects a secret name with characters Secret Manager does not allow', () => {
    expect(() => parseSecretBindings('DATABASE_URL=docket database url:latest')).toThrow(
      /invalid secret binding name/,
    );
  });

  it('rejects a version with characters Secret Manager does not allow', () => {
    expect(() => parseSecretBindings('DATABASE_URL=docket-database-url:not a version')).toThrow(
      /invalid secret binding version/,
    );
  });
});

describe('requiredProductionSecretEnvNames', () => {
  it('omits the Linear Agent secrets when the feature is disabled', () => {
    expect(requiredProductionSecretEnvNames(false)).not.toContain('LINEAR_AGENT_CLIENT_ID');
  });

  it('includes the Linear Agent secrets when the feature is enabled', () => {
    expect(requiredProductionSecretEnvNames(true)).toContain('LINEAR_AGENT_CLIENT_ID');
  });
});

describe('validateSecretBindings', () => {
  const binding = (envName: string): SecretBinding => ({
    envName,
    secretName: `docket-${envName.toLowerCase().replaceAll('_', '-')}`,
    version: 'latest',
  });

  it('reports every required env name with no binding at all', () => {
    const issues = validateSecretBindings([], () => 'a-real-value', ['DATABASE_URL']);
    expect(issues).toEqual([
      { envName: 'DATABASE_URL', secretName: '<binding>', reason: 'invalid-binding' },
    ]);
  });

  it('reports a second binding for an env name already seen, and skips reading its value', () => {
    let reads = 0;
    const issues = validateSecretBindings(
      [binding('DATABASE_URL'), binding('DATABASE_URL')],
      () => {
        reads += 1;
        return 'a-real-value';
      },
      [],
    );
    expect(issues).toEqual([{ ...binding('DATABASE_URL'), reason: 'duplicate-env' }]);
    expect(reads).toBe(1);
  });

  it('reports a binding whose Secret Manager read throws as unavailable', () => {
    const issues = validateSecretBindings(
      [binding('DATABASE_URL')],
      () => {
        throw new Error('not found');
      },
      [],
    );
    expect(issues).toEqual([{ ...binding('DATABASE_URL'), reason: 'unavailable' }]);
  });

  it('reports a binding whose value is a placeholder rather than a real secret', () => {
    const issues = validateSecretBindings([binding('DATABASE_URL')], () => '', []);
    expect(issues).toEqual([{ ...binding('DATABASE_URL'), reason: 'placeholder' }]);
  });

  it('reports nothing when every required binding is present and reads a real value', () => {
    const issues = validateSecretBindings(
      [binding('DATABASE_URL'), binding('CRON_SECRET')],
      () => 'a-real-value',
      ['DATABASE_URL', 'CRON_SECRET'],
    );
    expect(issues).toEqual([]);
  });
});
