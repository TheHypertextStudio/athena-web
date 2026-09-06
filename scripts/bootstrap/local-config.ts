import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { VAR_REGISTRY } from '../../packages/env/src/registry';

import { parseEnvFile } from '../env-file';

import { writeFileIfChanged } from './atomic-file';

/** One safe-to-print local configuration problem. Values are never included. */
export interface LocalConfigDiagnostic {
  readonly id: string;
  readonly message: string;
  readonly recovery: string;
}

/** Inputs to local environment convergence. */
export interface LocalConfigOptions {
  readonly envPath: string;
  readonly examplePath: string;
  readonly platform: 'darwin' | 'linux';
  readonly generateSecret?: (name: string) => string;
}

/** Result of local environment convergence. */
export interface LocalConfigResult {
  readonly changed: boolean;
  readonly diagnostics: readonly LocalConfigDiagnostic[];
}

const GENERATED_NAMES = new Set(
  VAR_REGISTRY.filter((spec) => spec.required && spec.generate !== undefined).map(
    (spec) => spec.name,
  ),
);

function defaultSecret(name: string): string {
  return name === 'CRON_SECRET'
    ? randomBytes(24).toString('hex')
    : randomBytes(32).toString('base64');
}

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
    values[name] = quoted ? raw.slice(1, -1) : raw;
  }
  return values;
}

function replaceOrAppend(text: string, name: string, value: string): string {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) {
    lines[index] = `${name}=${value}`;
    return lines.join('\n');
  }
  const suffix = text.endsWith('\n') ? '' : '\n';
  return `${text}${suffix}${name}=${value}\n`;
}

function safeUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function valuesFromApi(api: URL | undefined): Record<string, string> {
  if (!api) return {};
  return {
    BETTER_AUTH_URL: api.origin,
    NEXT_PUBLIC_API_URL: api.origin,
    MCP_ISSUER_URL: api.origin,
    MCP_RESOURCE_URL: `${api.origin}/mcp`,
  };
}

function valuesFromWeb(web: URL | undefined, api: URL | undefined): Record<string, string> {
  if (!web) return {};
  const adminOrigin = `${web.protocol}//admin.${web.hostname}`;
  return {
    NEXT_PUBLIC_APP_URL: web.origin,
    OIDC_LOGIN_PAGE_URL: `${web.origin}/sign-in`,
    MCP_ALLOWED_ORIGINS: web.origin,
    BETTER_AUTH_TRUSTED_ORIGINS: `${web.origin},${adminOrigin}`,
    ...(api
      ? {
          BETTER_AUTH_ALLOWED_HOSTS: [web.host, new URL(adminOrigin).host, api.host].join(','),
        }
      : {}),
    BETTER_AUTH_COOKIE_DOMAIN: web.hostname,
    BETTER_AUTH_PASSKEY_RP_ID: web.hostname,
    NEXT_PUBLIC_PASSKEY_RP_ID: web.hostname,
  };
}

function derivedValues(values: Readonly<Record<string, string>>): Record<string, string> {
  const api = safeUrl(values['API_URL']);
  const web = safeUrl(values['WEB_URL']);
  return { ...valuesFromApi(api), ...valuesFromWeb(web, api) };
}

function diagnostic(
  id: string,
  message: string,
  recovery = 'Correct the named value in .env.local, then run ./bootstrap again.',
): LocalConfigDiagnostic {
  return { id, message, recovery };
}

function registryDiagnostics(values: Readonly<Record<string, string>>): LocalConfigDiagnostic[] {
  const diagnostics: LocalConfigDiagnostic[] = [];
  for (const spec of VAR_REGISTRY) {
    const value = values[spec.name];
    if (value === undefined || value === '') {
      if (spec.required) {
        diagnostics.push(
          diagnostic(`env.${spec.name}.missing`, `${spec.name} is required.`, spec.where),
        );
      }
      continue;
    }
    const parsed = spec.zod.safeParse(value);
    if (!parsed.success) {
      diagnostics.push(
        diagnostic(
          `env.${spec.name}.invalid`,
          `${spec.name} is malformed: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
          spec.where,
        ),
      );
    }
  }
  return diagnostics;
}

function originDiagnostics(values: Readonly<Record<string, string>>): LocalConfigDiagnostic[] {
  const originNames = [
    'API_URL',
    'WEB_URL',
    'BETTER_AUTH_URL',
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_APP_URL',
    'MCP_ISSUER_URL',
    'MCP_RESOURCE_URL',
    'OIDC_LOGIN_PAGE_URL',
  ] as const;
  return originNames.flatMap((name) => {
    const value = values[name];
    const url = safeUrl(value);
    return value && (!url || !['http:', 'https:'].includes(url.protocol))
      ? [diagnostic(`env.${name}.invalid`, `${name} must be an absolute HTTP(S) URL.`)]
      : [];
  });
}

interface Relationship {
  readonly name: string;
  readonly expected: string | undefined;
  readonly id: string;
  readonly message: string;
}

function relationshipDiagnostics(
  values: Readonly<Record<string, string>>,
): LocalConfigDiagnostic[] {
  const expected = derivedValues(values);
  const relationships: readonly Relationship[] = [
    {
      name: 'BETTER_AUTH_URL',
      expected: values['API_URL'],
      id: 'env.auth.api-origin-mismatch',
      message: 'BETTER_AUTH_URL must match API_URL so callbacks and cookies return to this API.',
    },
    {
      name: 'NEXT_PUBLIC_API_URL',
      expected: values['API_URL'],
      id: 'env.client.api-origin-mismatch',
      message: 'NEXT_PUBLIC_API_URL must match API_URL so the browser reaches this checkout.',
    },
    {
      name: 'NEXT_PUBLIC_APP_URL',
      expected: values['WEB_URL'],
      id: 'env.client.web-origin-mismatch',
      message: 'NEXT_PUBLIC_APP_URL must match WEB_URL so client redirects stay on this checkout.',
    },
    {
      name: 'MCP_ISSUER_URL',
      expected: values['API_URL'],
      id: 'env.mcp.issuer-mismatch',
      message: 'MCP_ISSUER_URL must match API_URL when explicitly set locally.',
    },
    {
      name: 'MCP_RESOURCE_URL',
      expected: values['API_URL'] ? `${withoutTrailingSlash(values['API_URL'])}/mcp` : undefined,
      id: 'env.mcp.resource-mismatch',
      message: 'MCP_RESOURCE_URL must be API_URL plus /mcp.',
    },
    {
      name: 'OIDC_LOGIN_PAGE_URL',
      expected: values['WEB_URL']
        ? `${withoutTrailingSlash(values['WEB_URL'])}/sign-in`
        : undefined,
      id: 'env.mcp.login-origin-mismatch',
      message: 'OIDC_LOGIN_PAGE_URL must be WEB_URL plus /sign-in.',
    },
    {
      name: 'BETTER_AUTH_PASSKEY_RP_ID',
      expected: expected['BETTER_AUTH_PASSKEY_RP_ID'],
      id: 'env.auth.passkey-server-rp-mismatch',
      message: 'BETTER_AUTH_PASSKEY_RP_ID must match the local web hostname.',
    },
    {
      name: 'NEXT_PUBLIC_PASSKEY_RP_ID',
      expected: values['BETTER_AUTH_PASSKEY_RP_ID'],
      id: 'env.auth.passkey-rp-mismatch',
      message: 'NEXT_PUBLIC_PASSKEY_RP_ID must match the server passkey RP ID.',
    },
    {
      name: 'BETTER_AUTH_COOKIE_DOMAIN',
      expected: expected['BETTER_AUTH_COOKIE_DOMAIN'],
      id: 'env.auth.cookie-domain-mismatch',
      message: 'BETTER_AUTH_COOKIE_DOMAIN must be the shared local parent domain.',
    },
  ];
  return relationships.flatMap((relationship) => {
    const actual = values[relationship.name];
    return actual &&
      relationship.expected &&
      withoutTrailingSlash(actual) !== withoutTrailingSlash(relationship.expected)
      ? [diagnostic(relationship.id, relationship.message)]
      : [];
  });
}

/**
 * Validate registry rules and Docket's host-sensitive local relationships.
 *
 * @param values - Parsed environment values.
 * @returns safe diagnostics in stable registry/relationship order.
 */
export function validateLocalConfig(
  values: Readonly<Record<string, string>>,
): LocalConfigDiagnostic[] {
  const modeDiagnostics =
    values['APP_MODE'] === 'local'
      ? []
      : [diagnostic('env.APP_MODE.not-local', 'APP_MODE must be local in .env.local.')];
  return [
    ...registryDiagnostics(values),
    ...modeDiagnostics,
    ...originDiagnostics(values),
    ...relationshipDiagnostics(values),
  ];
}

interface ReconcileState {
  content: string;
  readonly values: Record<string, string>;
}

function fillEmpty(state: ReconcileState, entries: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(entries)) {
    if (state.values[name] !== undefined && state.values[name] !== '') continue;
    state.content = replaceOrAppend(state.content, name, value);
    state.values[name] = value;
  }
}

function fillGenerated(
  state: ReconcileState,
  exampleValues: Readonly<Record<string, string>>,
  existed: boolean,
  generateSecret: (name: string) => string,
): void {
  for (const name of GENERATED_NAMES) {
    const current = state.values[name];
    const copiedPlaceholder = !existed && current === exampleValues[name];
    if (current && !copiedPlaceholder) continue;
    const value = generateSecret(name);
    state.content = replaceOrAppend(state.content, name, value);
    state.values[name] = value;
  }
}

function fillMissing(state: ReconcileState, entries: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(entries)) {
    if (state.values[name] !== undefined) continue;
    state.content = replaceOrAppend(state.content, name, value);
    state.values[name] = value;
  }
}

/**
 * Converge `.env.local` from the checked-in example and registry without replacing manual values.
 *
 * Missing or empty derived/generated values are repaired. Non-empty malformed or inconsistent
 * values are reported and preserved for explicit operator correction. The destination is replaced
 * atomically only when its bytes change.
 *
 * @param options - Reconciliation paths, host platform, and injectable secret generator.
 * @returns whether bytes changed plus all remaining safe diagnostics.
 */
export function reconcileLocalConfig(options: LocalConfigOptions): LocalConfigResult {
  // Platform is deliberately part of the contract even though today's native defaults are equal;
  // neither macOS nor Linux may silently acquire a package-manager-specific environment shape.
  void options.platform;
  const generateSecret = options.generateSecret ?? defaultSecret;
  const exampleText = readFileSync(options.examplePath, 'utf8');
  const exampleValues = parseEnvText(exampleText);
  const existed = existsSync(options.envPath);
  const content = existed ? readFileSync(options.envPath, 'utf8') : exampleText;
  const state: ReconcileState = { content, values: parseEnvText(content) };

  fillEmpty(state, derivedValues(state.values));
  fillGenerated(state, exampleValues, existed, generateSecret);
  fillMissing(state, exampleValues);

  const diagnostics = validateLocalConfig(state.values);
  const changed = writeFileIfChanged(options.envPath, state.content, 0o600);
  // Reparse the on-disk result in development/tests so the serializer and parser cannot drift.
  if (process.env['NODE_ENV'] !== 'production') void parseEnvFile(options.envPath);
  return { changed, diagnostics };
}
