/**
 * Print this checkout's dev topology for a shell to consume.
 *
 * @remarks
 * `scripts/dev-stack.sh` used to declare its own twenty exports, which made it the fourth place
 * that decided what a dev host looks like. It now asks for them:
 *
 * ```bash
 * base=$(… --print-base)          # derive, so the shell can probe for a free block
 * eval "$(… --base="$chosen")"    # then take the whole topology at the block it settled on
 * ```
 *
 * The probing stays in the shell because it reads what is actually listening with `lsof`, which is
 * shell's job; the derivation and the host names come from here so there is one copy of each.
 */
import { deriveWebPort, readCheckoutIdentity } from '../src/checkout';
import { explicitPortTopology, shellExports } from '../src/topology';

interface Options {
  readonly root: string;
  readonly base: number | undefined;
  readonly printBase: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let root = process.cwd();
  let base: number | undefined;
  let printBase = false;

  for (const arg of argv) {
    if (arg === '--print-base') {
      printBase = true;
      continue;
    }
    const [name, value] = arg.split('=', 2);
    if (name === '--root' && value) root = value;
    else if (name === '--base' && value) base = Number.parseInt(value, 10);
    else if (name === '--mode' && value && value !== 'ports') {
      throw new Error(`dev-topology: unknown mode "${value}"; only "ports" is printable`);
    }
  }

  if (base !== undefined && !Number.isInteger(base)) {
    throw new Error('dev-topology: --base must be an integer');
  }
  return { root, base, printBase };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const identity = readCheckoutIdentity(options.root);

  if (options.printBase) {
    process.stdout.write(`${options.base ?? deriveWebPort(identity)}\n`);
    return;
  }

  const topology = explicitPortTopology(identity, options.base);
  process.stdout.write(`${shellExports(topology.env)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
