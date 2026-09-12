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

/** Lowest base port worth accepting: below 1024 needs privilege to bind. */
const LOWEST_BASE = 1024;

/** Highest base port that still leaves room for the whole stride below 65535. */
const HIGHEST_BASE = 65_531;

/**
 * Read a base port, rejecting anything that cannot become a bindable block.
 *
 * @remarks
 * A full-string match, because `parseInt` accepted `1416abc` as 1416 and `0` as a valid integer —
 * and `base ?? derived` keeps a zero, so the stack came up on ports 0 through 3 and failed in the
 * supervisor rather than here. `scripts/dev-stack.sh` forwards `DOCKET_DEV_PORT` straight into this
 * flag, so this is also where a mistyped override is caught.
 *
 * @throws When the value is not a decimal integer inside the bindable range.
 */
function parseBase(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`dev-topology: --base must be a decimal port number, got "${value}"`);
  }
  const base = Number.parseInt(value, 10);
  if (base < LOWEST_BASE || base > HIGHEST_BASE) {
    throw new Error(
      `dev-topology: --base must be between ${LOWEST_BASE} and ${HIGHEST_BASE}, got ${base}`,
    );
  }
  return base;
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
    else if (name === '--base' && value !== undefined) base = parseBase(value);
    else if (name === '--mode' && value && value !== 'ports') {
      throw new Error(`dev-topology: unknown mode "${value}"; only "ports" is printable`);
    }
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
