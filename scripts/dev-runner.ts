/**
 * Start the Athena runner on this checkout's own port.
 *
 * @remarks
 * `wrangler dev --local` binds `8787` unless told otherwise, and that default is the same number in
 * every checkout. Under `pnpm dev` the second worktree to start therefore either failed to bind or
 * — worse — the first one answered for both, so a request meant for this branch's runner executed
 * against another branch's worker. It is the same defect the web, api and admin ports had, on the
 * one service that was not part of any topology.
 *
 * `DOCKET_RUNNER_PORT` is honoured when the caller already chose a block (which
 * `scripts/dev-stack.sh` does, after probing what is actually listening). Otherwise this is the
 * Portless path, and the port comes from the dedicated runner range rather than the explicit-port
 * block — see `PORTLESS_RUNNER_FLOOR` for why the two must not overlap. An explicit `--port` in the
 * argv always wins.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { derivePortlessRunnerPort, readCheckoutIdentity } from '@docket/dev-topology';

/** The runner port for this checkout, preferring a port the caller already settled on. */
export function resolveRunnerPort(
  env: Record<string, string | undefined> = process.env,
  root: string = process.cwd(),
): number {
  const provided = env['DOCKET_RUNNER_PORT'];
  if (provided && /^\d+$/.test(provided)) return Number.parseInt(provided, 10);
  return derivePortlessRunnerPort(readCheckoutIdentity(root));
}

function main(): void {
  const [command, ...argv] = process.argv.slice(2);
  if (!command) {
    console.error('dev-runner: expected a command, e.g. `dev-runner wrangler dev --local`');
    process.exit(2);
  }

  const args = [...argv];
  if (!args.includes('--port')) {
    args.push('--port', String(resolveRunnerPort()));
  }

  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// Only run the launcher when invoked directly, so the port resolution can be imported and tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
