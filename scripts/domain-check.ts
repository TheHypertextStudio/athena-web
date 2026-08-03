/**
 * `pnpm domain:check` — the domain cutover's evidence tool.
 *
 * @remarks
 * Four questions come up repeatedly while moving Docket onto its own apex, and each was being
 * answered by hand with a different command every time. This script answers all four the same
 * way twice, which is what makes the answers usable as evidence:
 *
 * - `hosts` — what host does each role resolve to **right now**, from this environment, and does
 *   the isolation invariant hold? (GEN-25)
 * - `availability` — is a candidate name actually unregistered, according to the registry's own
 *   RDAP service rather than a resolver's silence? (GEN-23)
 * - `probe` — does every resolved host answer over HTTPS with a certificate whose SAN covers it?
 *   (GEN-24)
 * - `verify` — does a workspace's custom domain currently prove ownership? (CORE-31)
 * - `legacy` — where does the old apex still appear **outside** shipped source, i.e. the places
 *   `packages/env/tests/hosts/legacy-host-policy.test.ts` deliberately does not police?
 *
 * Exits non-zero when a check fails, so it can gate a deploy.
 *
 * @example
 * ```bash
 * pnpm tsx scripts/domain-check.ts hosts
 * pnpm tsx scripts/domain-check.ts availability docket.place athena.day
 * pnpm tsx scripts/domain-check.ts probe
 * pnpm tsx scripts/domain-check.ts verify example.com 3f2a…
 * pnpm tsx scripts/domain-check.ts legacy
 * ```
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolveTxt } from 'node:dns/promises';
import { connect, type PeerCertificate } from 'node:tls';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

import {
  assertHostConfigIsolated,
  type HostConfig,
  HOST_ROLES,
  resolveHostConfig,
  verifyCustomDomain,
  WEB_HOST_ROLES,
} from '../packages/env/src/index';

/** Repo root, relative to this script. */
const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * The legacy apex, assembled from parts.
 *
 * @remarks
 * Written this way for the same reason the policy test is: at cutover a human runs a repo-wide
 * grep for the hostname and expects a clean result. A tool whose job is to *find* the hostname
 * must not be the thing that makes that grep dirty.
 */
const LEGACY_APEX = ['hypertext', 'studio'].join('.');

/** Candidate names checked when `availability` is given no arguments (see `docs/engineering/domains.md`). */
const DEFAULT_CANDIDATES = [
  'docket.place',
  'everydocket.com',
  'runthedocket.com',
  'docketeveryday.com',
  'athena.day',
  'athenaday.com',
  'quietathena.com',
  'athena.place',
] as const;

/** Minimal `.env` parser (KEY=VALUE, `#` comments, optional quotes) — no dependency. */
function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  } catch {
    return; // file absent — fine
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

/** The host contract as this environment resolves it. */
function currentConfig(): HostConfig {
  return resolveHostConfig({
    rootDomain: process.env['PUBLIC_ROOT_DOMAIN'] ?? process.env['NEXT_PUBLIC_ROOT_DOMAIN'],
    appUrl: process.env['WEB_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'],
    apiUrl: process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'],
    adminUrl: process.env['ADMIN_URL'],
    briefHost: process.env['PUBLIC_BRIEF_HOST'] ?? process.env['NEXT_PUBLIC_BRIEF_HOST'],
    athenaInboundMailHost: process.env['ATHENA_INBOUND_MAIL_HOST'],
    customDomainTarget: process.env['CUSTOM_DOMAIN_CNAME_TARGET'],
    passkeyRpId: process.env['BETTER_AUTH_PASSKEY_RP_ID'],
    supportEmail: process.env['SUPPORT_EMAIL'] ?? process.env['NEXT_PUBLIC_SUPPORT_EMAIL'],
  });
}

/** Print the resolved host table and check the isolation invariant. Returns the exit code. */
function commandHosts(): number {
  const config = currentConfig();
  console.log(`apex          ${config.rootDomain ?? '(unresolved)'}`);
  console.log(`passkey RP id ${config.passkeyRpId ?? '(unresolved)'}`);
  console.log(`support       ${config.supportEmail ?? '(unresolved)'}`);
  console.log(`custom target ${config.customDomainTarget ?? '(unresolved)'}`);
  console.log('');
  for (const role of HOST_ROLES) {
    const resolved = config.hosts[role];
    console.log(
      resolved ? `${role.padEnd(12)} ${resolved.origin}` : `${role.padEnd(12)} (unconfigured)`,
    );
  }
  console.log('');
  try {
    assertHostConfigIsolated(config);
    console.log('isolation     OK — every user-facing host sits on the product apex');
    return 0;
  } catch (error) {
    console.error(`isolation     FAILED — ${(error as Error).message}`);
    return 1;
  }
}

/** How a registry answered about one name. */
type Availability = 'available' | 'registered' | 'inconclusive';

/** RDAP base URLs by TLD, from IANA's bootstrap file. */
async function rdapBootstrap(): Promise<Map<string, string>> {
  const response = await fetch('https://data.iana.org/rdap/dns.json');
  const body: { services: [string[], string[]][] } = await response.json();
  const map = new Map<string, string>();
  for (const [tlds, bases] of body.services) {
    const base = bases[0];
    if (base === undefined) continue;
    for (const tld of tlds) map.set(tld, base.endsWith('/') ? base : `${base}/`);
  }
  return map;
}

/**
 * Ask the registry's own RDAP service whether a name is registered.
 *
 * @remarks
 * RDAP, not WHOIS parsing and not `dig`. A missing `NS` delegation is *evidence* a name is free
 * but not proof — a registered, undelegated domain looks identical — and buying on that evidence
 * is how someone discovers at checkout that the name is taken. A registry RDAP `404` is the
 * registry itself saying the object does not exist.
 */
async function rdapLookup(name: string, bases: Map<string, string>): Promise<Availability> {
  const tld = name.split('.').pop();
  const base = tld === undefined ? undefined : bases.get(tld);
  if (base === undefined) return 'inconclusive';
  let response: Response;
  try {
    response = await fetch(`${base}domain/${name}`, { redirect: 'follow' });
  } catch {
    return 'inconclusive';
  }
  if (response.status === 404) return 'available';
  if (response.status === 200) return 'registered';
  return 'inconclusive';
}

/** Check availability for the given names (or the committed shortlist). */
async function commandAvailability(names: readonly string[]): Promise<number> {
  const candidates = names.length > 0 ? names : DEFAULT_CANDIDATES;
  const bases = await rdapBootstrap();
  let inconclusive = 0;
  for (const name of candidates) {
    const result = await rdapLookup(name, bases);
    if (result === 'inconclusive') inconclusive += 1;
    console.log(`${name.padEnd(24)} ${result}`);
  }
  console.log('');
  console.log(
    'Source: the registry RDAP service named by https://data.iana.org/rdap/dns.json. ' +
      '"available" is a registry 404; it is a point-in-time answer, so re-check at purchase.',
  );
  return inconclusive > 0 ? 1 : 0;
}

/** The certificate's subject-alternative names, lowercased. */
function certificateSans(cert: PeerCertificate): string[] {
  const raw = cert.subjectaltname ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/i, '').toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Whether a SAN entry (possibly a wildcard) covers `host`. */
function sanCovers(san: string, host: string): boolean {
  if (san === host) return true;
  if (!san.startsWith('*.')) return false;
  const suffix = san.slice(1); // ".example.com"
  return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes('.');
}

/** Read the TLS certificate a host presents, without issuing a request. */
async function peerCertificate(host: string): Promise<PeerCertificate | undefined> {
  return new Promise((done) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      done(cert);
    });
    socket.on('error', () => {
      done(undefined);
    });
    socket.on('timeout', () => {
      socket.destroy();
      done(undefined);
    });
  });
}

/** Probe every web host over HTTPS and check its certificate actually covers it. */
async function commandProbe(): Promise<number> {
  const config = currentConfig();
  let failures = 0;
  for (const role of WEB_HOST_ROLES) {
    const resolved = config.hosts[role];
    if (!resolved) {
      console.log(`${role.padEnd(8)} (unconfigured)`);
      continue;
    }
    let status: string;
    try {
      const response = await fetch(resolved.origin, { method: 'HEAD', redirect: 'manual' });
      status = String(response.status);
      const location = response.headers.get('location');
      if (location) status += ` → ${location}`;
    } catch {
      status = 'unreachable';
      failures += 1;
    }
    const cert = await peerCertificate(resolved.host);
    const sans = cert ? certificateSans(cert) : [];
    const covered = sans.some((san) => sanCovers(san, resolved.host));
    if (!covered) failures += 1;
    console.log(
      `${role.padEnd(8)} ${resolved.host.padEnd(36)} HTTP ${status.padEnd(28)} ` +
        `SAN ${covered ? 'covers host' : `does NOT cover host [${sans.join(' ') || 'none'}]`}`,
    );
  }
  return failures > 0 ? 1 : 0;
}

/** Run the real DNS ownership check for one custom domain. */
async function commandVerify(host: string | undefined, token: string | undefined): Promise<number> {
  if (host === undefined || token === undefined) {
    console.error('usage: domain-check.ts verify <host> <token>');
    return 2;
  }
  const result = await verifyCustomDomain({ host, token, lookupTxt: resolveTxt });
  console.log(`record        ${result.record.type} ${result.record.name}`);
  console.log(`expected      ${result.record.value}`);
  console.log(`observed      ${result.observedCount} Docket record(s)`);
  console.log(`verified      ${result.verified ? 'yes' : `no (${result.failure})`}`);
  return result.verified ? 0 : 1;
}

/** Directories never scanned for legacy references. */
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next', '.git', '.data']);

/** Every file under `dir` whose extension suggests it is text worth scanning. */
function textFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (SKIPPED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...textFilesUnder(full));
    else if (/\.(ts|tsx|js|mjs|cjs|yml|yaml|json|sh)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Report every legacy-apex reference outside shipped source.
 *
 * @remarks
 * The policy test polices `apps/*&#47;src`, `packages/*&#47;src`, and `services/*&#47;src`. Everything else
 * — operator scripts, CI workflows, deployment configuration — still has to be repointed at
 * cutover, and this is the list. Reporting it beats remembering it, which is the failure mode
 * `docs/engineering/domain-cutover.md` §3.2 exists to prevent.
 */
function commandLegacy(): number {
  const roots = ['scripts', '.github', 'infra', 'tooling'];
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of textFilesUnder(join(REPO_ROOT, root))) {
      const contents = readFileSync(file, 'utf8');
      if (!contents.includes(LEGACY_APEX)) continue;
      contents.split('\n').forEach((line, index) => {
        if (line.includes(LEGACY_APEX)) {
          hits.push(`${relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  if (hits.length === 0) {
    console.log('No legacy-apex references outside shipped source.');
    return 0;
  }
  console.log(`${hits.length} legacy-apex reference(s) to repoint at cutover:`);
  for (const hit of hits) console.log(`  ${hit}`);
  console.log('');
  console.log(
    'These are prompts, defaults, and deployment configuration — not shipped code, which the ' +
      'policy test already forbids. Each still needs updating when the final domain lands.',
  );
  return 0;
}

/** Entry point. */
async function main(): Promise<void> {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const [command = 'hosts', ...rest] = process.argv.slice(2);
  let code: number;
  switch (command) {
    case 'hosts':
      code = commandHosts();
      break;
    case 'availability':
      code = await commandAvailability(rest);
      break;
    case 'probe':
      code = await commandProbe();
      break;
    case 'verify':
      code = await commandVerify(rest[0], rest[1]);
      break;
    case 'legacy':
      code = commandLegacy();
      break;
    default:
      console.error(
        `unknown command "${command}" — expected hosts|availability|probe|verify|legacy`,
      );
      code = 2;
  }
  process.exitCode = code;
}

await main();
