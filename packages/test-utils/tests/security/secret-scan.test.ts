import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOW_MARKER,
  REPO_ROOT,
  collectTrackedFiles,
  formatReport,
  loadSecretScanConfig,
  parseToml,
  redactSecret,
  scanFiles,
  shannonEntropy,
  type ScannedFile,
  type SecretScanConfig,
} from '../../../../scripts/secret-scan';

/**
 * The gate for GEN-06's first clause: no credential is committed to this repository.
 *
 * @remarks
 * Half of this file is the obvious half — run the production rule set over the real tracked tree
 * and assert zero findings. On its own that assertion is worthless: a scanner whose regexes never
 * match anything passes it just as happily as a correct one, and a repository that is clean today
 * would keep it green while the rules silently rotted.
 *
 * So the other half feeds the SAME configuration synthetic credentials — one per rule — and
 * asserts each rule actually fires, that the redaction never prints a usable value, and that each
 * allowlist suppresses only what it claims to. Those two halves together are what make the clean
 * scan mean something.
 *
 * The fixtures below are credential-SHAPED but fake. Each carries a trailing `gitleaks:allow`
 * comment so the real-tree scan in the first test skips this file's own lines — the same escape
 * hatch a legitimate fixture anywhere else in the repo would use. The marker lives in this test's
 * source, not inside the fixture strings, so the in-memory scan still sees an unmarked line and
 * the rules still fire.
 */

/** Every rule id `.gitleaks.toml` is expected to declare, in file order. */
const EXPECTED_RULE_IDS = [
  'anthropic-api-key',
  'stripe-live-key',
  'aws-access-key-id',
  'github-token',
  'slack-token',
  'google-api-key',
  'private-key-block',
  'jwt',
  'resend-api-key',
  'postgres-connection-string',
  'twilio-account-sid',
  'generic-assigned-secret',
] as const;

/** A synthetic file that a named rule must flag. */
interface RuleFixture {
  /** The rule expected to produce the finding. */
  readonly ruleId: string;
  /** What makes this shape worth detecting. */
  readonly why: string;
  /** One-line file body containing the fake credential. */
  readonly content: string;
}

/**
 * One fake credential per rule.
 *
 * @remarks
 * Values are structurally realistic (correct prefixes and lengths) because several rules are
 * length-anchored — `AIza` + exactly 35 characters, `ghp_` + exactly 36 — and a fixture that is
 * merely "prefix plus some letters" would pass while proving nothing about the real pattern.
 */
const RULE_FIXTURES: readonly RuleFixture[] = [
  {
    ruleId: 'anthropic-api-key',
    why: "Athena's model-provider credential — the highest-value key in the deployment",
    content:
      'ANTHROPIC_API_KEY=sk-ant-api03-9Fk2QmZ8vTrLp4XwNc7YbHd1Ge6Ja0Kn5Mo3Pq8Rs2Tu7Vw4Xy9Zb1Cd6Ef3Gh8Ij5Kl0Mn7Op2Qr9St4Uv1AA', // gitleaks:allow
  },
  {
    ruleId: 'stripe-live-key',
    why: 'a live-mode Stripe key can move real money; test-mode keys deliberately do not match',
    content: 'STRIPE_SECRET_KEY=sk_live_51NpQ7rZ2aVdKxJmT4hLcWb', // gitleaks:allow
  },
  {
    ruleId: 'aws-access-key-id',
    why: 'paired with a secret key it is full cloud-account access',
    content: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', // gitleaks:allow
  },
  {
    ruleId: 'github-token',
    why: 'a classic PAT can push to every repository the author can reach',
    content: 'GITHUB_TOKEN=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', // gitleaks:allow
  },
  {
    ruleId: 'github-token',
    why: 'the fine-grained PAT form has a different prefix and must match the same rule',
    content: 'GITHUB_TOKEN=github_pat_11ABCDEFG0abcdefghijklmnopqr', // gitleaks:allow
  },
  {
    ruleId: 'slack-token',
    why: 'the Slack connector stores bot and user tokens; either reads a whole workspace',
    content: 'SLACK_BOT_TOKEN=xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx', // gitleaks:allow
  },
  {
    ruleId: 'google-api-key',
    why: 'the calendar integration is Google-backed',
    content: 'GOOGLE_API_KEY=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', // gitleaks:allow
  },
  {
    ruleId: 'private-key-block',
    why: 'a pasted PEM block is a signing identity, not just an API credential',
    content: '-----BEGIN RSA PRIVATE KEY-----', // gitleaks:allow
  },
  {
    ruleId: 'jwt',
    why: 'a pasted session or access token grants whatever it was minted for until it expires',
    content:
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM', // gitleaks:allow
  },
  {
    ruleId: 'resend-api-key',
    why: 'Resend sends every Docket notification; a leaked key sends mail as Docket',
    content: 'RESEND_API_KEY=re_AbCdEfGh_12345678901234', // gitleaks:allow
  },
  {
    ruleId: 'postgres-connection-string',
    why: 'a Neon connection string is the production database itself',
    content:
      'DATABASE_URL=postgres://neondb_owner:npg_7Xk2QmZ8vTrLp4Xw@ep-cool-mountain-1.us-east-2.aws.neon.tech/docket', // gitleaks:allow
  },
  {
    ruleId: 'twilio-account-sid',
    why: 'an account SID identifies the messaging account a paired auth token unlocks',
    content: 'TWILIO_ACCOUNT_SID=AC0123456789abcdef0123456789abcdef', // gitleaks:allow
  },
  {
    ruleId: 'generic-assigned-secret',
    why: 'catches vendors the config does not enumerate, by shape and entropy rather than prefix',
    content: 'WEBHOOK_SIGNING_SECRET="xQz2LpV9naK4RtY6wUeI0oS3dF8gHjB5cM"', // gitleaks:allow
  },
];

/** Values an allowlist must suppress, with the reason the exemption is legitimate. */
const ALLOWED_FIXTURES: readonly RuleFixture[] = [
  {
    ruleId: 'postgres-connection-string',
    why: 'the committed local-dev Postgres URL — loopback, and the password is the word "docket"',
    content: 'DATABASE_URL=postgres://docket:docket@localhost:5433/docket',
  },
  {
    ruleId: 'postgres-connection-string',
    why: 'RFC 2606 documentation host used by packages/db migration tests',
    content: "vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://user:pw@db.example.invalid/docket');",
  },
  {
    ruleId: 'generic-assigned-secret',
    why: 'the API test env value — low entropy and carries the "test" stopword',
    content: "BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',",
  },
  {
    ruleId: 'generic-assigned-secret',
    why: "the committed .env.local dev secret, allowlisted by exact value in the config's [allowlist]",
    content: 'BETTER_AUTH_SECRET=dev-local-shared-secret-not-for-production-use-0000',
  },
];

/** The production configuration, loaded once. */
function productionConfig(): SecretScanConfig {
  return loadSecretScanConfig(join(REPO_ROOT, '.gitleaks.toml'));
}

/** Wrap a fixture body as a single scannable file. */
function fixtureFile(content: string, path = 'fixture/candidate.env'): ScannedFile[] {
  return [{ path, content }];
}

describe('secret scan — the real repository', () => {
  it('reports zero findings across every tracked file', () => {
    const config = productionConfig();
    const files = collectTrackedFiles(REPO_ROOT);
    const findings = scanFiles(files, config);

    // A floor on the file set: if `git ls-files` ever returned nothing, the scan would pass
    // vacuously and this suite would report a clean repository it never actually read.
    expect(files.length).toBeGreaterThan(500);
    expect(formatReport(config, files.length, findings)).toContain('PASS');
    expect(findings).toEqual([]);
  });

  it('declares exactly the rules the launch gate expects', () => {
    expect(productionConfig().rules.map((rule) => rule.id)).toEqual([...EXPECTED_RULE_IDS]);
  });

  it('refuses a configuration that declares no rules', () => {
    // Guards the failure mode this whole file exists to prevent: a scan that passes because it
    // is looking for nothing. A config that only extends the upstream ruleset is exactly that,
    // as far as this scanner is concerned — it carries no bundled rules to inherit.
    const ruleless = join(mkdtempSync(join(tmpdir(), 'docket-secret-scan-')), 'gitleaks.toml');
    writeFileSync(ruleless, ['title = "empty"', '', '[extend]', 'useDefault = true'].join('\n'));
    expect(() => loadSecretScanConfig(ruleless)).toThrow(/no \[\[rules\]\]/);
  });
});

describe('secret scan — every rule fires', () => {
  for (const fixture of RULE_FIXTURES) {
    it(`flags ${fixture.ruleId}: ${fixture.why}`, () => {
      const findings = scanFiles(fixtureFile(fixture.content), productionConfig());
      expect(findings.map((finding) => finding.ruleId)).toContain(fixture.ruleId);
      expect(findings[0]?.line).toBe(1);
    });
  }

  it('reports the line a multi-line file was hit on', () => {
    const content = ['# nothing here', '', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'].join('\n'); // gitleaks:allow
    const findings = scanFiles(fixtureFile(content), productionConfig());
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'aws-access-key-id',
        line: 3,
        path: 'fixture/candidate.env',
      }),
    ]);
  });
});

describe('secret scan — allowlists suppress only what they claim', () => {
  for (const fixture of ALLOWED_FIXTURES) {
    it(`ignores ${fixture.why}`, () => {
      expect(scanFiles(fixtureFile(fixture.content), productionConfig())).toEqual([]);
    });
  }

  it(`honors an inline ${ALLOW_MARKER} comment on the matching line only`, () => {
    // Both keys are AWS's own published documentation examples, and both are built here rather
    // than matched: the first interpolates the marker, so the literal token never appears in this
    // file and the scanner would otherwise flag the source line that tests the exemption.
    const content = [
      `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE # ${ALLOW_MARKER}`, // gitleaks:allow
      'AWS_ACCESS_KEY_ID=AKIAI44QH8DHBEXAMPLE', // gitleaks:allow
    ].join('\n');
    const findings = scanFiles(fixtureFile(content), productionConfig());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it('skips files under an allowlisted path', () => {
    const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'; // gitleaks:allow
    expect(
      scanFiles(fixtureFile(content, 'node_modules/pkg/config.env'), productionConfig()),
    ).toEqual([]);
    // The same body outside the allowlisted path is still a finding — the exemption is the path,
    // not the value.
    expect(scanFiles(fixtureFile(content, 'apps/api/config.env'), productionConfig())).toHaveLength(
      1,
    );
  });

  it('holds the generic rule to an entropy floor rather than a wordlist', () => {
    const config = productionConfig();
    const generic = config.rules.find((rule) => rule.id === 'generic-assigned-secret');
    expect(generic?.entropy).toBe(4.5);
    // An English-shaped placeholder is below the floor; a random value is well above it.
    expect(shannonEntropy('test-secret-test-secret-test-secret-0123456789')).toBeLessThan(4.5);
    expect(shannonEntropy('xQz2LpV9naK4RtY6wUeI0oS3dF8gHjB5cM')).toBeGreaterThan(4.5);
  });
});

describe('secret scan — reporting', () => {
  it('never prints more than the first four characters of a candidate', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'; // gitleaks:allow
    const config = productionConfig();
    const findings = scanFiles(fixtureFile(`AWS_ACCESS_KEY_ID=${secret}`), config);
    const report = formatReport(config, 1, findings);

    expect(redactSecret(secret)).toBe('AKIA…(20 chars)');
    expect(report).toContain('FAIL — 1 finding(s):');
    expect(report).toContain('fixture/candidate.env:1  aws-access-key-id');
    expect(report).not.toContain(secret);
    expect(report).not.toContain(secret.slice(0, 8));
  });
});

describe('secret scan — the bundled TOML reader', () => {
  it('reads the constructs .gitleaks.toml actually uses', () => {
    const doc = parseToml(
      [
        'title = "example"',
        '',
        '[allowlist]',
        'description = """',
        'two',
        'lines',
        '"""',
        'paths = [',
        "  '''(^|/)node_modules/''',",
        "  '''^pnpm-lock\\.yaml$''',",
        ']',
        '',
        '[[rules]]',
        'id = "first"',
        "regex = '''a[0-9]{2}'''",
        'entropy = 4.5',
        'secretGroup = 1',
        '',
        '  [rules.allowlist]',
        '  stopwords = ["test"]',
        '',
        '[[rules]]',
        'id = "second"',
        "regex = '''b+'''",
        'useDefault = true',
      ].join('\n'),
    );

    expect(doc['title']).toBe('example');
    const allowlist = doc['allowlist'] as Record<string, unknown>;
    expect(allowlist['description']).toBe('two\nlines\n');
    expect(allowlist['paths']).toEqual(['(^|/)node_modules/', '^pnpm-lock\\.yaml$']);

    const rules = doc['rules'] as Record<string, unknown>[];
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ id: 'first', entropy: 4.5, secretGroup: 1 });
    // The sub-table attaches to the rule it follows, not to the document root.
    expect((rules[0]?.['allowlist'] as Record<string, unknown>)['stopwords']).toEqual(['test']);
    expect(rules[1]).toMatchObject({ id: 'second', useDefault: true });
  });

  it('translates a leading (?i) inline flag, which JavaScript has no spelling for', () => {
    const config = productionConfig();
    const generic = config.rules.find((rule) => rule.id === 'generic-assigned-secret');
    expect(generic?.regex.flags).toContain('i');
    expect(generic?.regex.source.startsWith('(?i)')).toBe(false);
    // Proven end to end: the fixture below spells the key name in lower case.
    expect(
      scanFiles(fixtureFile('webhook_secret = "xQz2LpV9naK4RtY6wUeI0oS3dF8gHjB5cM"'), config), // gitleaks:allow
    ).toHaveLength(1);
  });
});
