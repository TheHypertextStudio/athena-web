import { resolve } from 'node:path';

/** Options shared by the route and named-state screenshot entry points. */
export interface CliArgs {
  session: string;
  outDir: string;
  /**
   * Capture against a different origin than the session was created on.
   *
   * @remarks
   * The session cookie is scoped to `.docket.localhost`, so one sign-in reaches every app in the
   * stack. That makes this tool usable for the admin console — same auth, same shot set, same
   * overflow check — without a second capture harness to keep correct.
   */
  baseURL?: string | undefined;
  routes: string[];
  audit: boolean;
  start: number;
  limit: number | undefined;
  frameStart: number;
  frameLimit: number | undefined;
  records: string | undefined;
  clickButton: string | undefined;
  clickRow: string | undefined;
  clickMenuItem: string | undefined;
  clickTab: string | undefined;
  clickAfter: readonly string[];
  scenarios: string | undefined;
  allowState: 'loading' | 'error' | undefined;
  continueOnError: boolean;
  failures: string | undefined;
}

/** Parse existing route flags and opt-in named-state/batch controls. */
export function parseCaptureArgs(argv: string[]): CliArgs {
  const { flags, routes } = splitCaptureArgs(argv);
  const audit = argv.includes('--audit');
  if (!audit && !flags.has('scenarios') && routes.length === 0) {
    throw new Error('capture-shots: pass at least one route, e.g. /today');
  }
  return {
    session: resolve(flags.get('session') ?? 'playwright/.auth/dev-session.json'),
    outDir: resolve(flags.get('out') ?? '.data/design-review-shots'),
    baseURL: flags.get('base-url'),
    routes,
    audit,
    start: integerFlag(flags, 'start') ?? 0,
    limit: integerFlag(flags, 'limit'),
    frameStart: integerFlag(flags, 'frame-start') ?? 0,
    frameLimit: integerFlag(flags, 'frame-limit'),
    records: pathFlag(flags, 'records'),
    clickButton: flags.get('click-button'),
    clickRow: flags.get('click-row'),
    clickMenuItem: flags.get('click-menu-item'),
    clickTab: flags.get('click-tab'),
    clickAfter: flags.get('click-after')?.split('|') ?? [],
    scenarios: pathFlag(flags, 'scenarios'),
    allowState: parseAllowedState(flags.get('allow-state')),
    continueOnError: argv.includes('--continue-on-error'),
    failures: pathFlag(flags, 'failures'),
  };
}

function parseAllowedState(value: string | undefined): CliArgs['allowState'] {
  if (value === undefined || value === 'loading' || value === 'error') return value;
  throw new Error('capture-shots: --allow-state must be loading or error');
}

function splitCaptureArgs(argv: string[]): { flags: Map<string, string>; routes: string[] } {
  const flags = new Map<string, string>();
  const routes: string[] = [];
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) flags.set(key, value);
    } else if (arg !== '--audit' && arg !== '--continue-on-error') {
      routes.push(arg);
    }
  }
  return { flags, routes };
}

function integerFlag(flags: Map<string, string>, name: string): number | undefined {
  const value = flags.get(name);
  return value === undefined ? undefined : Number.parseInt(value, 10);
}

function pathFlag(flags: Map<string, string>, name: string): string | undefined {
  const value = flags.get(name);
  return value === undefined ? undefined : resolve(value);
}
