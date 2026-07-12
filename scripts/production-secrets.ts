/**
 * Production Secret Manager binding validation shared by the operator tooling and deploy gate.
 *
 * @remarks
 * Secret payloads are read only long enough to apply the shared real-value policy. Diagnostics
 * contain environment/secret names and failure reasons, never credential contents.
 */
import { execFileSync } from 'node:child_process';

import { isRealValue } from '../packages/env/src/real-value';

/** One Cloud Run environment-variable to Secret Manager mapping. */
export interface SecretBinding {
  /** Runtime environment variable receiving the secret. */
  readonly envName: string;
  /** Secret Manager object name. */
  readonly secretName: string;
  /** Secret Manager version, normally `latest`. */
  readonly version: string;
}

/** A safe, value-free production binding failure. */
export interface SecretValidationIssue {
  readonly envName: string;
  readonly secretName: string;
  readonly reason: 'duplicate-env' | 'invalid-binding' | 'unavailable' | 'placeholder';
}

/** The production values required for the deployed account/linking surface. */
export const REQUIRED_PRODUCTION_SECRET_ENV_NAMES = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'DATABASE_URL_UNPOOLED',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SECRET',
] as const;

/** Parse the multiline `API_SECRET_BINDINGS` format without accepting shell syntax. */
export function parseSecretBindings(raw: string): SecretBinding[] {
  const bindings: SecretBinding[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    const colon = trimmed.lastIndexOf(':');
    if (equals <= 0 || colon <= equals + 1 || colon === trimmed.length - 1) {
      throw new Error('invalid secret binding format');
    }
    const envName = trimmed.slice(0, equals);
    const secretName = trimmed.slice(equals + 1, colon);
    const version = trimmed.slice(colon + 1);
    if (!/^[A-Z][A-Z0-9_]*$/.test(envName) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(secretName)) {
      throw new Error('invalid secret binding name');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error('invalid secret binding version');
    bindings.push({ envName, secretName, version });
  }
  return bindings;
}

/** Validate all bindings with an injected value reader so tests never call GCP. */
export function validateSecretBindings(
  bindings: readonly SecretBinding[],
  readValue: (binding: SecretBinding) => string,
  requiredEnvNames: readonly string[] = REQUIRED_PRODUCTION_SECRET_ENV_NAMES,
): SecretValidationIssue[] {
  const issues: SecretValidationIssue[] = [];
  const seen = new Set<string>();
  const byEnv = new Map(bindings.map((binding) => [binding.envName, binding]));

  for (const required of requiredEnvNames) {
    if (!byEnv.has(required)) {
      issues.push({
        envName: required,
        secretName: '<binding>',
        reason: 'invalid-binding',
      });
    }
  }

  for (const binding of bindings) {
    if (seen.has(binding.envName)) {
      issues.push({ ...binding, reason: 'duplicate-env' });
      continue;
    }
    seen.add(binding.envName);
    let value: string;
    try {
      value = readValue(binding);
    } catch {
      issues.push({ ...binding, reason: 'unavailable' });
      continue;
    }
    if (!isRealValue(value)) issues.push({ ...binding, reason: 'placeholder' });
  }
  return issues;
}

/** Read one Secret Manager version without exposing its payload to stdout/stderr. */
export function readSecretManagerValue(binding: SecretBinding, project: string): string {
  return execFileSync(
    'gcloud',
    [
      'secrets',
      'versions',
      'access',
      binding.version,
      `--secret=${binding.secretName}`,
      `--project=${project}`,
      '--quiet',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function main(): void {
  const project = process.env['GCP_PROJECT_ID'];
  if (!project) throw new Error('GCP_PROJECT_ID is required');

  const bindings = parseSecretBindings(process.env['API_SECRET_BINDINGS'] ?? '');
  bindings.push({
    envName: 'DATABASE_URL_UNPOOLED',
    secretName: 'docket-database-url-unpooled',
    version: 'latest',
  });
  const issues = validateSecretBindings(bindings, (binding) =>
    readSecretManagerValue(binding, project),
  );
  if (issues.length > 0) {
    console.error('Production secret validation failed:');
    for (const issue of issues) {
      console.error(`- ${issue.envName} (${issue.secretName}): ${issue.reason}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${bindings.length} production Secret Manager bindings.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
