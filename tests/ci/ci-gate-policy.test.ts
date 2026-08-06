import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkGatePolicy,
  formatReport,
  isCheckJob,
  isGatingCommand,
  isReportingStep,
  loadWorkflows,
  parseWorkflow,
  parseYaml,
  REPO_ROOT,
  type PolicyFinding,
} from '../../scripts/ci-gate-policy';

/**
 * Builds a synthetic workflow around a `deploy-production` job so a rule can be
 * exercised in isolation from the real pipeline.
 *
 * @param jobsYaml - YAML for the jobs under test, indented two spaces
 * @param needs - Contents of `deploy-production.needs`
 * @returns The workflow source text
 */
function fixture(jobsYaml: string, needs: string[]): string {
  return [
    'name: Fixture',
    'on:',
    '  push:',
    '    branches: [main]',
    'jobs:',
    jobsYaml.replace(/\n$/, ''),
    '  deploy-production:',
    '    name: Deploy production',
    `    needs: [${needs.join(', ')}]`,
    '    uses: ./.github/workflows/deploy.yml',
    '',
  ].join('\n');
}

/** Runs the policy over a synthetic workflow. */
function check(jobsYaml: string, needs: string[]): PolicyFinding[] {
  return checkGatePolicy([parseWorkflow('fixture.yml', fixture(jobsYaml, needs))]);
}

describe('YAML subset reader', () => {
  it('reads the structures GitHub Actions workflows are made of', () => {
    const doc = parseYaml(
      [
        'name: Demo',
        'on:',
        '  push:',
        '    branches: [main, next]',
        'env:',
        '  QUOTED: "a: b"',
        "  APOSTROPHE: 'it''s fine'",
        '  TRUTHY: true',
        '  COUNT: 12',
        '  EXPR: ${{ secrets.TOKEN }}',
        'jobs:',
        '  one:',
        '    # a structural comment, not data',
        '    needs: build',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '        with:',
        '          fetch-depth: 0',
        '      - name: Multi',
        '        run: |',
        '          # this hash is shell, not YAML',
        '          echo "hello # world"',
        '',
        '          echo done',
        '        continue-on-error: true',
      ].join('\n'),
    ) as Record<string, never>;

    expect(doc).toMatchObject({
      name: 'Demo',
      on: { push: { branches: ['main', 'next'] } },
      env: {
        QUOTED: 'a: b',
        APOSTROPHE: "it's fine",
        TRUTHY: true,
        COUNT: 12,
        EXPR: '${{ secrets.TOKEN }}',
      },
      jobs: {
        one: {
          needs: 'build',
          steps: [
            { uses: 'actions/checkout@v6', with: { 'fetch-depth': 0 } },
            {
              name: 'Multi',
              run: '# this hash is shell, not YAML\necho "hello # world"\n\necho done\n',
              'continue-on-error': true,
            },
          ],
        },
      },
    });
  });

  it('normalizes a scalar `needs` to a list and keeps a flow sequence intact', () => {
    const scalar = parseWorkflow('f.yml', 'jobs:\n  a:\n    needs: build\n    steps: []\n');
    expect(scalar.jobs[0]?.needs).toEqual(['build']);

    const flow = parseWorkflow('f.yml', 'jobs:\n  a:\n    needs: [x, y, z]\n    steps: []\n');
    expect(flow.jobs[0]?.needs).toEqual(['x', 'y', 'z']);
  });

  it('refuses to guess at syntax it does not model', () => {
    expect(() => parseYaml('jobs:\n  a: 1\n   b: 2\n')).toThrow(/Unexpected indentation/);
    expect(() => parseWorkflow('f.yml', 'name: no jobs here\n')).toThrow(/no jobs mapping/);
  });
});

describe('gating-command detection', () => {
  it('recognizes the check commands this repo actually runs', () => {
    expect(isGatingCommand('pnpm turbo run test --cache-dir=.turbo')).toBe(true);
    expect(isGatingCommand('pnpm turbo run test:coverage --cache-dir=.turbo')).toBe(true);
    expect(isGatingCommand('pnpm turbo run lint typecheck --cache-dir=.turbo')).toBe(true);
    expect(isGatingCommand('pnpm turbo run build --cache-dir=.turbo')).toBe(true);
    expect(isGatingCommand('pnpm format:check')).toBe(true);
    expect(isGatingCommand('pnpm --filter @docket/web test:e2e')).toBe(true);
    expect(isGatingCommand('pnpm exec vitest run tests')).toBe(true);
    expect(isGatingCommand('pnpm test:tooling')).toBe(true);
    expect(isGatingCommand('pnpm secret-scan')).toBe(true);
    expect(isGatingCommand('pnpm ci:gate-policy')).toBe(true);
  });

  it('does not mistake setup, diagnostics, or prose for a check', () => {
    expect(isGatingCommand('pnpm install --no-frozen-lockfile')).toBe(false);
    expect(isGatingCommand('pnpm exec portless proxy start --port 1355 --no-tls')).toBe(false);
    expect(isGatingCommand('pnpm dev > /tmp/dev.log 2>&1 &')).toBe(false);
    expect(isGatingCommand('echo "running the latest build test suite"')).toBe(false);
    expect(isGatingCommand('pnpm turbo run --help')).toBe(false);
    // The readiness poll in the e2e job: `|| true` is fine here because it gates nothing.
    expect(
      isGatingCommand('web=$(curl -s -o /dev/null http://docket.localhost:1355 || true)'),
    ).toBe(false);
  });
});

describe('SCR-19 — every check job must gate the deploy', () => {
  it('reports a new test job that was never added to deploy-production.needs', () => {
    const findings = check(
      [
        '  contract-tests:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '      - run: pnpm exec vitest run tests/contracts',
      ].join('\n'),
      ['build'],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'SCR-19', job: 'contract-tests' });
    expect(findings[0]?.message).toContain('deploy-production.needs');
  });

  it('reports a check job implemented purely as an action', () => {
    const findings = check(
      [
        '  secret-scan:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '      - uses: gitleaks/gitleaks-action@v3',
      ].join('\n'),
      ['build'],
    );

    expect(findings.map((finding) => finding.job)).toEqual(['secret-scan']);
  });

  it('accepts the job once it is listed, and never flags setup-only jobs', () => {
    const jobs = [
      '  contract-tests:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: pnpm exec vitest run tests/contracts',
      '  warm-cache:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: pnpm install --no-frozen-lockfile',
    ].join('\n');

    expect(check(jobs, ['contract-tests'])).toEqual([]);
  });
});

describe('SCR-20 — no gating step may be soft-failed', () => {
  it('reports continue-on-error inside a check job', () => {
    const findings = check(
      [
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm turbo run test',
        '        continue-on-error: true',
      ].join('\n'),
      ['test'],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'SCR-20', job: 'test' });
    expect(findings[0]?.message).toContain('continue-on-error');
  });

  it('reports job-level continue-on-error, which lets dependents run anyway', () => {
    const findings = check(
      [
        '  test:',
        '    runs-on: ubuntu-latest',
        '    continue-on-error: true',
        '    steps:',
        '      - run: pnpm turbo run test',
      ].join('\n'),
      ['test'],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.step).toBeNull();
    expect(findings[0]?.message).toContain('job-level continue-on-error');
  });

  it('reports `|| true` appended to a check command', () => {
    const findings = check(
      [
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm turbo run test || true',
      ].join('\n'),
      ['test'],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('|| true');
  });

  it('reports a check command forced to run under if: always()', () => {
    const findings = check(
      [
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm install',
        '      - name: Tests',
        '        if: always()',
        '        run: pnpm turbo run test',
      ].join('\n'),
      ['test'],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.step).toBe('Tests');
    expect(findings[0]?.message).toContain('if: always()');
  });

  it('leaves if: always() on reporting steps alone — the deliberate carve-out', () => {
    const findings = check(
      [
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm turbo run test',
        '      - id: coverage',
        '        if: always()',
        '        run: find . -name coverage-final.json -print -quit',
        '      - uses: codecov/codecov-action@v7',
        "        if: always() && steps.coverage.outputs.found == 'true'",
        '      - uses: actions/upload-artifact@v6',
        '        if: always()',
      ].join('\n'),
      ['test'],
    );

    expect(findings).toEqual([]);
  });

  it('classifies the reporting steps it exempts', () => {
    const workflow = parseWorkflow(
      'f.yml',
      [
        'jobs:',
        '  test:',
        '    steps:',
        '      - run: pnpm turbo run test',
        '      - uses: codecov/codecov-action@v7',
        '      - run: echo diagnostics',
      ].join('\n'),
    );
    const [gate, codecov, diagnostics] = workflow.jobs[0]!.steps;

    expect(isReportingStep(gate!)).toBe(false);
    expect(isReportingStep(codecov!)).toBe(true);
    expect(isReportingStep(diagnostics!)).toBe(true);
  });

  it('ignores soft-failure in a job that runs no checks at all', () => {
    const findings = check(
      [
        '  notify:',
        '    runs-on: ubuntu-latest',
        '    continue-on-error: true',
        '    steps:',
        '      - run: curl -sS https://example.invalid/hook || true',
        '        continue-on-error: true',
      ].join('\n'),
      [],
    );

    expect(findings).toEqual([]);
  });
});

describe('the real workflows', () => {
  const workflows = loadWorkflows();

  it('parses every file in .github/workflows', () => {
    expect(workflows.map((workflow) => workflow.path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      // e2e lives in its own workflow and deliberately does not gate the deploy — it runs against
      // `next dev`, so Turbopack compiles routes inside the tests and the suite cannot pass on a
      // two-core runner. SCR-19 is unaffected: it governs the workflow that owns
      // `deploy-production`, and a check job outside that file is not a gate it can skip.
      '.github/workflows/e2e.yml',
      '.github/workflows/neon-branch.yml',
    ]);
  });

  it('satisfies both gate rules', () => {
    const findings = checkGatePolicy(workflows);
    expect(formatReport(workflows, findings)).toContain('PASS');
    expect(findings).toEqual([]);
  });

  it('gates the production deploy on every check job ci.yml declares', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const deploy = ci?.jobs.find((job) => job.id === 'deploy-production');
    const checkJobs = (ci?.jobs ?? []).filter((job) => isCheckJob(job)).map((job) => job.id);

    // Recorded expectation: adding a check job to ci.yml must update this list *and*
    // deploy-production.needs, which is exactly the coupling SCR-19 asks for.
    expect(checkJobs).toEqual(['lint', 'typecheck', 'secret-scan', 'test', 'build']);
    expect(deploy?.needs).toEqual(['lint', 'typecheck', 'secret-scan', 'test', 'build']);
  });

  it('runs the coverage gate — a bare `vitest run` enforces no thresholds (SCR-15)', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    // One job, not two. `test` and `coverage` ran the same suites over the same file set; only
    // the `test:coverage` script applies tooling/vitest/preset.ts's thresholds, so that is the
    // command the gate has to see.
    const test = ci?.jobs.find((job) => job.id === 'test');
    const commands = (test?.steps ?? []).flatMap((step) => (step.run ? [step.run] : []));

    expect(commands).toContain('pnpm turbo run test:coverage --cache-dir=.turbo');
    expect(commands).not.toContain('pnpm turbo run test --cache-dir=.turbo');
    expect(test?.steps.every((step) => !step.continueOnError)).toBe(true);
  });

  it('runs the secret scan against the committed .gitleaks.toml (GEN-06 clause 1)', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const scan = ci?.jobs.find((job) => job.id === 'secret-scan');
    const commands = (scan?.steps ?? []).flatMap((step) => (step.run ? [step.run] : []));

    // The gate is the in-repo scanner, not gitleaks/gitleaks-action: the action needs a licence
    // key for org-owned repositories, and a gate that cannot be turned green gets deleted rather
    // than fixed. `scripts/secret-scan.ts` reads the same `.gitleaks.toml` rules with no network
    // call, so the gate holds on a runner with no egress and no vendor account.
    expect(commands).toContain('pnpm secret-scan');
    expect(scan?.steps.every((step) => !step.continueOnError)).toBe(true);

    // Full history on the checkout, so the licensed `gitleaks git` second opinion can run against
    // this same clone when someone installs the key.
    const checkout = scan?.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with['fetch-depth']).toBe(0);

    // The config must exist and must inherit gitleaks' maintained upstream ruleset, so that
    // second opinion covers providers this repo has not enumerated by hand. The rule and
    // allowlist bodies are intentionally not asserted here: they are security policy that should
    // be free to tighten without editing this test.
    const config = readFileSync(join(REPO_ROOT, '.gitleaks.toml'), 'utf8');
    expect(config).toMatch(/^\[extend\]$/m);
    expect(config).toMatch(/^useDefault = true$/m);
  });

  it('runs the gate policy itself in CI, so the guard cannot rot unnoticed', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const commands = (ci?.jobs ?? []).flatMap((job) =>
      job.steps.flatMap((step) => (step.run ? [step.run] : [])),
    );

    expect(commands).toContain('pnpm ci:gate-policy');
  });
});
