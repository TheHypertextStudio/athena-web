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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { hostPrefix, isLinkedWorktree, isPathInside, readCheckoutIdentity } from '../src/checkout';
import { checkDevTopology, formatTopologyFindings } from '../src/consistency';
import { applyDevHostPrefix, type EnvBag } from '../src/hosts';
import { explicitPortTopology } from '../src/topology';

/** Who is listening on a port, and whether the process belongs to this checkout. */
interface Listener {
  readonly pid: string;
  readonly cwd: string | undefined;
  readonly mine: boolean;
}

function listenerOn(port: number, root: string): Listener | undefined {
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
    // Same rule the shell applies, from the same helper — a substring test read a sibling
    // worktree's process as our own and suppressed the warning this exists to raise.
    return { pid, cwd, mine: cwd !== undefined && isPathInside(cwd, root) };
  } catch {
    return undefined;
  }
}

function describe(listener: Listener): string {
  return `pid ${listener.pid}${listener.cwd ? ` (cwd ${listener.cwd})` : ''}`;
}

/**
 * The env a launcher would hand this checkout's processes, from the checked-in file.
 *
 * @remarks
 * The file is parsed into its own bag rather than inferred from what `process.loadEnvFile` adds to
 * `process.env`. That inference dropped every variable the caller had already exported — so running
 * this after `eval "$(dev-stack.sh env)"`, or in any shell where someone had exported `API_URL` by
 * hand, silently excluded the exact values being diagnosed and then reported the result coherent.
 */
function launcherEnv(root: string, prefix: string): EnvBag {
  const envPath = resolve(root, '.env.local');
  const env: EnvBag = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, name, raw] = match;
      if (!name || raw === undefined) continue;
      const trimmed = raw.trim();
      const quoted = /^(['"])(.*)\1$/.exec(trimmed);
      env[name] = quoted?.[2] ?? trimmed.replace(/\s+#.*$/, '');
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
    const listener = listenerOn(port, identity.root);
    if (!listener) continue;
    const held = describe(listener);
    out.push(
      `  ${service} port ${port} is held by ${held}${listener.mine ? ' — this checkout' : ''}`,
    );
    if (!listener.mine) foreign.push(`${service} port ${port}: ${held}`);
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
