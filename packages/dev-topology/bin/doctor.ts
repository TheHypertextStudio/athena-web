/**
 * Report what this checkout's dev topology is, and whether it holds together.
 *
 * @remarks
 * This is the command to run instead of reading auth logs. It answers the three questions that a
 * host mismatch turns into an afternoon:
 *
 * 1. Which hosts and ports does *this* checkout own?
 * 2. Does the environment a launcher would produce contradict itself?
 * 3. Is anything else already answering those ports?
 *
 * The environment is checked as a launcher would leave it — the checked-in `.env.local` names the
 * canonical hosts, and in a worktree that file is *supposed* to disagree with the running stack
 * until `scripts/portless-env.ts` corrects it. Checking the file as written would therefore report
 * a problem in every worktree, so the prefix is applied first and the result is what gets checked.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readCheckoutIdentity, hostPrefix, isLinkedWorktree } from '../src/checkout';
import { checkDevTopology, formatTopologyFindings } from '../src/consistency';
import { applyDevHostPrefix, type EnvBag } from '../src/hosts';
import { explicitPortTopology } from '../src/topology';

function listenerOn(port: number): string | undefined {
  try {
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0];
    if (!pid) return undefined;
    const cwd = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    return `pid ${pid}${cwd ? ` (cwd ${cwd})` : ''}`;
  } catch {
    return undefined;
  }
}

/** The env a launcher would hand this checkout's processes, from the checked-in file. */
function launcherEnv(root: string, prefix: string): EnvBag {
  const envPath = resolve(root, '.env.local');
  const env: EnvBag = {};
  if (existsSync(envPath)) {
    const before = new Set(Object.keys(process.env));
    process.loadEnvFile(envPath);
    for (const [name, value] of Object.entries(process.env)) {
      if (!before.has(name)) env[name] = value;
    }
  }
  if (prefix) applyDevHostPrefix(env, prefix.replace(/\.$/, ''));
  return env;
}

function main(): void {
  const root = process.cwd();
  const identity = readCheckoutIdentity(root);
  const topology = explicitPortTopology(identity);
  const prefix = hostPrefix(identity);

  const out: string[] = [
    `checkout   : ${identity.root}`,
    `branch     : ${identity.branch}${isLinkedWorktree(identity) ? ' (linked worktree)' : ' (primary)'}`,
    `host prefix: ${prefix || '(none)'}`,
    '',
    'explicit-port mode — scripts/dev-stack.sh',
    `  web    ${topology.ports.web}  ${topology.appUrl}`,
    `  api    ${topology.ports.api}  ${topology.apiUrl}`,
    `  admin  ${topology.ports.admin}  ${topology.adminUrl}`,
    `  runner ${topology.ports.runner}  ${topology.runnerUrl}`,
  ];

  const foreign: string[] = [];
  const services: readonly (readonly [string, number])[] = [
    ['web', topology.ports.web],
    ['api', topology.ports.api],
    ['admin', topology.ports.admin],
    ['runner', topology.ports.runner],
  ];
  for (const [service, port] of services) {
    const listener = listenerOn(port);
    if (!listener) continue;
    const mine = listener.includes(`cwd ${identity.root}`);
    out.push(`  ${service} port ${port} is held by ${listener}${mine ? ' — this checkout' : ''}`);
    if (!mine) foreign.push(`${service} port ${port}: ${listener}`);
  }

  const findings = checkDevTopology(launcherEnv(root, prefix));
  out.push('', 'portless mode — pnpm dev');
  out.push(
    findings.length === 0
      ? '  the environment a launcher would produce is coherent'
      : `  ${formatTopologyFindings(findings)}`,
  );

  if (foreign.length > 0) {
    out.push(
      '',
      'Another checkout holds a port in this block. Every *.docket.localhost host resolves to',
      "127.0.0.1, so that process would answer this stack's URLs. Stop it, or set DOCKET_DEV_PORT.",
    );
  }

  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
