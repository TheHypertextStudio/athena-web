import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkGatePolicy,
  formatReport,
  isAdvisoryWorkflow,
  isCheckJob,
  isGatingCommand,
  isReportingStep,
  loadWorkflows,
  parseWorkflow,
  parseYaml,
  REPO_ROOT,
  type PolicyFinding,
} from '../../scripts/ci-gate-policy';
import { assertDefined } from '@docket/test-utils';
import { VAR_REGISTRY } from '../../packages/env/src/registry';

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

function isCompleteReleaseDirectoryCommand(command: string | undefined): boolean {
  return command?.trim() === 'pnpm --filter @docket/web test:e2e:release';
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

describe('ungated-check-job — every check job must gate the deploy', () => {
  it('rejects a standalone check workflow unless it is explicitly advisory', () => {
    const workflow = parseWorkflow(
      'browser-tests.yml',
      [
        'name: Browser tests',
        'jobs:',
        '  e2e:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm --filter @docket/web test:e2e',
      ].join('\n'),
    );

    const findings = checkGatePolicy([workflow]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'ungated-check-job', job: 'e2e', step: null });
    expect(findings[0]?.message).toContain('explicitly advisory');
  });

  it('allows a standalone check workflow only when it carries the advisory source directive', () => {
    const workflow = parseWorkflow(
      'browser-tests.yml',
      [
        '# ci-gate-policy: advisory',
        'name: Browser tests',
        'jobs:',
        '  e2e:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm --filter @docket/web test:e2e',
      ].join('\n'),
    );

    expect(isAdvisoryWorkflow(workflow)).toBe(true);
    expect(checkGatePolicy([workflow])).toEqual([]);
  });

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
    expect(findings[0]).toMatchObject({ rule: 'ungated-check-job', job: 'contract-tests' });
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

describe('soft-failed-gate — no gating step may be soft-failed', () => {
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
    expect(findings[0]).toMatchObject({ rule: 'soft-failed-gate', job: 'test' });
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
    const [gate, codecov, diagnostics] = assertDefined(workflow.jobs[0]).steps;

    expect(isReportingStep(assertDefined(gate))).toBe(false);
    expect(isReportingStep(assertDefined(codecov))).toBe(true);
    expect(isReportingStep(assertDefined(diagnostics))).toBe(true);
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
      // Runs only on operator dispatch. It reads billing launch evidence through the production
      // Workload Identity boundary and never participates in a push or deployment gate.
      '.github/workflows/billing-production-audit.yml',
      // Builds the deploy images. ci.yml invokes it with no `needs` so it overlaps the gates;
      // it runs no tests or checks, so it is not a gate and holds nothing back.
      '.github/workflows/build-images.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      // e2e is a check job that deliberately does not gate the deploy; see e2e.yml for why.
      // The ungated-check-job rule is unaffected — it only governs the workflow that owns
      // `deploy-production`, so a check job in another file is not a gate that file can skip.
      '.github/workflows/e2e.yml',
      '.github/workflows/neon-branch.yml',
    ]);
  });

  it('satisfies both gate rules', () => {
    const findings = checkGatePolicy(workflows);
    expect(formatReport(workflows, findings)).toContain('PASS');
    expect(findings).toEqual([]);
  });

  it('marks the non-gating browser suite as advisory without renaming its GitHub check', () => {
    const e2e = workflows.find((workflow) => workflow.path === '.github/workflows/e2e.yml');
    const report = formatReport(workflows, checkGatePolicy(workflows));

    expect(e2e?.name).toBe('E2E');
    expect(e2e).toBeDefined();
    if (!e2e) throw new Error('Expected the E2E workflow fixture');
    expect(isAdvisoryWorkflow(e2e)).toBe(true);
    expect(report).toContain('advisory check workflow(s): .github/workflows/e2e.yml');
  });

  it('preserves pnpm links when the E2E build crosses the artifact boundary', () => {
    const source = readFileSync(join(REPO_ROOT, '.github/workflows/e2e.yml'), 'utf8');

    expect(source).toContain('tar -C apps/web/.next/standalone -czf web-standalone.tar.gz .');
    expect(source).toContain('path: web-standalone.tar.gz');
    expect(source).toContain('tar -xzf web-standalone.tar.gz -C apps/web/.next/standalone');
    expect(source).not.toContain('path: apps/web/.next/standalone');
  });

  it('gates the production deploy on every check job ci.yml declares', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const deploy = ci?.jobs.find((job) => job.id === 'deploy-production');
    const checkJobs = (ci?.jobs ?? []).filter((job) => isCheckJob(job)).map((job) => job.id);

    // Recorded expectation: adding a check job to ci.yml must update this list *and*
    // deploy-production.needs, which is exactly the coupling the ungated-check-job rule enforces.
    expect(checkJobs).toEqual([
      'lint',
      'typecheck',
      'secret-scan',
      'test',
      'build',
      'core-screen-smoke',
    ]);
    // `build-images` and `still-latest` are in `needs` without being check jobs, and the
    // asymmetry is deliberate: neither runs tests, so the ungated-check-job rule does not require
    // them, but the
    // deploy consumes the images `build-images` pushes and stands down when `still-latest` finds
    // `main` has moved past this commit — both are real data/ordering dependencies. Every check
    // job still appears here.
    expect(deploy?.needs).toEqual([
      'lint',
      'typecheck',
      'secret-scan',
      'test',
      'build',
      'core-screen-smoke',
      'build-images',
      'still-latest',
    ]);
    expect(checkJobs.every((job) => deploy?.needs.includes(job))).toBe(true);

    const freshness = ci?.jobs.find((job) => job.id === 'still-latest');
    expect(freshness?.needs).toContain('core-screen-smoke');
  });

  it('runs the coverage gate — a bare `vitest run` enforces no thresholds', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    // The job is sharded across a package matrix, so the gating command now carries a
    // `--filter`. What must hold is what held before sharding: the command that runs is
    // `test:coverage` — the only script tooling/vitest/preset.ts applies thresholds to — never a
    // bare `turbo run test`, and no step in the job is soft-failed.
    const test = ci?.jobs.find((job) => job.id === 'test');
    const commands = (test?.steps ?? []).flatMap((step) => (step.run ? [step.run] : []));

    expect(commands.some((command) => command.startsWith('pnpm turbo run test:coverage'))).toBe(
      true,
    );
    expect(commands.some((command) => /^pnpm turbo run test(?:\s|$)/.test(command))).toBe(false);
    expect(test?.steps.every((step) => !step.continueOnError)).toBe(true);
  });

  it('runs the complete release directory against PostgreSQL', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const smoke = ci?.jobs.find((job) => job.id === 'core-screen-smoke');
    const command = smoke?.steps.find((step) => step.run?.includes('test:e2e:release'))?.run;
    const source = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const smokeStart = source.indexOf('\n  core-screen-smoke:');
    const smokeEnd = source.indexOf('\n  build-images:', smokeStart);
    const smokeSource = source.slice(smokeStart, smokeEnd);

    expect(isCompleteReleaseDirectoryCommand(command)).toBe(true);
    expect(smokeSource).toMatch(/timeout-minutes:\s+(?:3\d|[4-9]\d|\d{3,})/);
    expect(smokeSource).not.toContain('.spec.ts');
    expect(smokeSource).not.toContain('continue-on-error');
    expect(source).toContain('image: postgres:17-alpine');
    expect(source).toContain('DATABASE_URL: postgres://docket:docket@127.0.0.1:5432/docket');
    expect(smoke?.continueOnError).toBe(false);
  });

  it('rejects an individual release spec as the browser gate command', () => {
    const individualSpecCommand =
      'pnpm --filter @docket/web exec playwright test e2e/release/core-screen-acceptance.spec.ts --workers=1';

    expect(isCompleteReleaseDirectoryCommand(individualSpecCommand)).toBe(false);
  });

  it('runs the API performance gate without coverage contention', () => {
    const apiPackage = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/api/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(apiPackage.scripts['test:coverage']).toContain(
      '--exclude tests/work-views/performance.test.ts',
    );
    expect(apiPackage.scripts['test:performance']).toBe(
      'vitest run tests/work-views/performance.test.ts --maxWorkers=1',
    );

    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const test = ci?.jobs.find((job) => job.id === 'test');
    const performanceStep = test?.steps.find(
      (step) => step.run === 'pnpm --filter @docket/api test:performance',
    );
    expect(performanceStep?.condition).toBe("matrix.group == 'api'");
    expect(performanceStep?.continueOnError).toBe(false);
  });

  it('leaves no package untested when the test job is sharded', () => {
    // Sharding introduces a failure mode the coverage gate cannot see: a package that matches
    // no shard's filter is never run, and a suite that never runs cannot fail. The protection is
    // structural — the catch-all group is defined by EXCLUSION (`--filter=!…`) rather than by an
    // enumerated list, so a newly added package lands there by default instead of nowhere.
    // Rewriting that group as a list of package names is the regression this guards against.
    const source = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const shardGroups = [...source.matchAll(/^ +- group: (\S+)$/gm)].flatMap(([, group]) =>
      group === undefined ? [] : [group],
    );
    const catchAlls = [...source.matchAll(/^ +filter: (--filter=!\S.*)$/gm)].flatMap(
      ([, filter]) => (filter === undefined ? [] : [filter]),
    );

    // Three gates are sharded — lint, typecheck, and test — and each needs its own catch-all.
    // Asserting the count rather than a fixed group list means adding a shard to an existing gate
    // is free, while adding one that enumerates packages instead of excluding them is not.
    expect(shardGroups.length).toBeGreaterThanOrEqual(9);
    expect(catchAlls).toHaveLength(3);
    for (const filter of catchAlls) {
      expect(filter.startsWith('--filter=!')).toBe(true);
    }
  });

  it('bounds every Turbo workspace gate to one package at a time', () => {
    const ci = workflows.find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const commands = (ci?.jobs ?? []).flatMap((job) =>
      job.steps.flatMap((step) => (step.run ? [step.run] : [])),
    );
    const turboGates = commands.filter((command) => command.startsWith('pnpm turbo run '));

    // The constraint is the flag, not the exact command text. Type-aware ESLint and `tsc` each
    // hold a whole TypeScript program per package — @docket/api's alone spikes to ~2.5GB — so a
    // gate that lets turbo schedule packages concurrently exhausts the runner. Asserting the flag
    // on every gate keeps that invariant while leaving shard filters free to change; matching
    // whole strings made adding a `--filter` look like removing the memory bound.
    expect(turboGates.length).toBeGreaterThanOrEqual(4);
    for (const gate of turboGates) {
      expect(gate).toContain('--concurrency=1');
    }
  });

  it('runs the secret scan against the committed .gitleaks.toml', () => {
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

describe('production carries every environment variable the API requires', () => {
  it('keeps enough API memory to generate and cache the public OpenAPI document', () => {
    const deploy = readFileSync(join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf8');
    const apiDeploy = deploy.slice(
      deploy.indexOf('- id: deploy-api'),
      deploy.indexOf('- name: Show Cloud Run URL'),
    );

    expect(apiDeploy).toContain('--memory=1Gi');
  });

  it('names each required, non-sensitive API var in the Cloud Run env file', () => {
    // The API validates its whole env contract at boot, so a required var missing from the deploy
    // is not a disabled feature — the container exits before it listens on $PORT and Cloud Run
    // fails the health check with nothing that names the variable. That is exactly how
    // WORK_LOCATION_PROJECTION_ENABLED took production down: it was added to the registry as
    // required and to `.env.example`, but never to deploy.yml.
    //
    // Only non-sensitive vars are checked here. Secrets are mounted from Secret Manager through
    // the `API_SECRET_BINDINGS` repository variable, which lives outside the repo and so cannot be
    // read from a test; `scripts/production-secrets.ts` validates that mapping at deploy time.
    // `PORT` is injected by Cloud Run itself.
    // Read the keys the env file actually assigns rather than searching the whole document. A
    // substring search passes on any mention, including prose: deploy.yml's own comments name
    // ATHENA_ASYNC_RUNNER_ENABLED, API_URL, and PORT, so deleting one of those assignments while
    // leaving its comment would have satisfied the check and shipped the very outage this guards.
    const deploy = readFileSync(join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf8');
    const envFile = /<<'EOF'\n([\s\S]*?)\n\s*EOF/.exec(deploy)?.[1] ?? '';
    const assigned = new Set(
      [...envFile.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map(([, key]) => key),
    );

    // The env file must be found at all — an empty match would make every var look present-by-
    // absence and quietly retire this gate.
    expect(assigned.size).toBeGreaterThan(0);

    const providedByPlatform = new Set(['PORT']);

    const missing = VAR_REGISTRY.filter(
      (entry) =>
        entry.required &&
        entry.targets.includes('api') &&
        entry.sensitive !== true &&
        !providedByPlatform.has(entry.name) &&
        !assigned.has(entry.name),
    ).map((entry) => entry.name);

    expect(missing, `deploy.yml is missing required API vars: ${missing.join(', ')}`).toEqual([]);
  });
});
