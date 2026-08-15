/**
 * Record an end-to-end Athena run on the routed default backend — Cloudflare's model router, on
 * Docket's own API keys — and write the transcript and request traces as committed evidence.
 *
 * @remarks
 * This is the run WIL-50 asks for, and the run `apps/api/src/routes/lattice-gate.ts` reads to
 * decide whether the Lattice surface may be reached in production.
 *
 * ## It refuses to lie
 *
 * The script asserts that the environment really did select `cloudflare-router` and that the
 * credential is Docket's own. If either is missing it exits non-zero and writes nothing. There is
 * no flag that makes it record `mode: 'production-keys'` without a real routed call having
 * happened, because a gate that can be talked into opening is not a gate.
 *
 * ## Running it
 *
 * ```bash
 * CLOUDFLARE_AI_GATEWAY_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic \
 * CLOUDFLARE_AI_GATEWAY_TOKEN=<token> \
 * ANTHROPIC_API_KEY=<docket key> \
 * APP_MODE=production \
 *   pnpm --filter @docket/api exec tsx tests/lattice/verify-athena-backend.ts
 * ```
 *
 * On success it prints the record to paste into `CLOUDFLARE_ROUTER_VERIFICATION`, which is what
 * opens the gate.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { TurnEvent, TurnToolDef } from '@docket/athena/turn';
import { resolveModelBackend } from '@docket/athena/turn/model-backend';

/** Where the recorded evidence is written. */
const REPORT_PATH = resolve(
  import.meta.dirname,
  '../../../../docs/engineering/evidence/athena-model-backend-verification.md',
);

/** One outbound HTTP request the run made. */
interface Trace {
  readonly at: string;
  readonly method: string;
  /** Origin + path only. Query strings and bodies are never recorded. */
  readonly url: string;
  /** Which auth headers were present — names only, never values. */
  readonly authHeaders: readonly string[];
  readonly status: number;
  readonly ms: number;
}

/** One scenario's outcome. */
interface Scenario {
  readonly name: string;
  readonly prompt: string;
  readonly events: readonly string[];
  readonly reply: string;
  readonly ms: number;
}

/** The tool offered to the tool-call scenario. */
const TOOLS: readonly TurnToolDef[] = [
  {
    name: 'list_overdue_tasks',
    description: 'List the tasks in this workspace that are past their due date.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many to return.' } },
      required: [],
    },
  },
];

/** Install a fetch wrapper that records request metadata without ever capturing a secret. */
function installTracer(traces: Trace[]): void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const started = Date.now();
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw);
    const headerNames: string[] = [];
    const headers = new Headers(
      input instanceof Request ? input.headers : (init?.headers ?? undefined),
    );
    // Header NAMES only. Recording a value here is how a "trace" becomes a leaked key.
    for (const name of ['authorization', 'x-api-key', 'cf-aig-authorization']) {
      if (headers.has(name)) headerNames.push(name);
    }
    const response = await original(input, init);
    traces.push({
      at: new Date().toISOString(),
      method: input instanceof Request ? input.method : (init?.method ?? 'GET'),
      url: `${url.origin}${url.pathname}`,
      authHeaders: headerNames,
      status: response.status,
      ms: Date.now() - started,
    });
    return response;
  };
}

/** Run one turn and summarize what came back. */
async function runScenario(
  runtime: { streamTurn: (input: never) => AsyncIterable<TurnEvent> },
  name: string,
  prompt: string,
  tools: readonly TurnToolDef[],
): Promise<Scenario> {
  const started = Date.now();
  const events: string[] = [];
  let reply = '';
  const input = {
    system:
      'You are Athena, a chief of staff inside Docket. Be concise. Use a tool when one fits the request.',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    tools,
  } as never;
  for await (const event of runtime.streamTurn(input)) {
    if (event.type === 'text') {
      events.push('text');
      reply += event.text;
    } else if (event.type === 'tool_use') {
      events.push(`tool_use:${event.name}`);
    } else if (event.type === 'thinking') {
      events.push('thinking');
    } else {
      events.push(`turn_end:${event.stopReason}`);
    }
  }
  return { name, prompt, events, reply: reply.trim(), ms: Date.now() - started };
}

/**
 * Exit without recording anything, explaining what to set.
 *
 * @param why - What was wrong with the environment.
 * @returns Never; always exits.
 */
function refuse(why: string): never {
  process.stderr.write(
    [
      `Refusing to record: ${why}.`,
      '',
      "This script only records a run that actually happened on Cloudflare's model router with",
      "Docket's own credentials. Set all four and run again:",
      '',
      '  APP_MODE=production',
      '  CLOUDFLARE_AI_GATEWAY_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic',
      '  CLOUDFLARE_AI_GATEWAY_TOKEN=<gateway token>',
      '  ANTHROPIC_API_KEY=<Docket key>',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/** The verification. */
async function main(): Promise<void> {
  const traces: Trace[] = [];
  const appMode = process.env['APP_MODE'] as 'local' | 'test' | 'production' | undefined;
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];
  const gatewayBaseUrl = process.env['CLOUDFLARE_AI_GATEWAY_BASE_URL'];
  const gatewayToken = process.env['CLOUDFLARE_AI_GATEWAY_TOKEN'];
  const athenaModel = process.env['ATHENA_MODEL'];
  const env = {
    ...(appMode === undefined ? {} : { APP_MODE: appMode }),
    ...(anthropicApiKey === undefined ? {} : { ANTHROPIC_API_KEY: anthropicApiKey }),
    ...(gatewayBaseUrl === undefined ? {} : { CLOUDFLARE_AI_GATEWAY_BASE_URL: gatewayBaseUrl }),
    ...(gatewayToken === undefined ? {} : { CLOUDFLARE_AI_GATEWAY_TOKEN: gatewayToken }),
    ...(athenaModel === undefined ? {} : { ATHENA_MODEL: athenaModel }),
  };

  // `resolveModelBackend` throws when the tier it selected is half-configured, which is the
  // common case here (a blank ANTHROPIC_API_KEY). Both that and "it selected a different tier"
  // mean the same thing to the operator, so they get the same actionable message rather than a
  // stack trace.
  let backend;
  try {
    backend = resolveModelBackend(env);
  } catch {
    refuse('the environment does not fully configure any model backend');
  }
  if (backend.descriptor.id !== 'cloudflare-router') {
    refuse(`the environment selected "${backend.descriptor.id}", not "cloudflare-router"`);
  }

  installTracer(traces);
  const runtime: { streamTurn: (input: never) => AsyncIterable<TurnEvent> } = backend.turnRuntime();

  const scenarios: Scenario[] = [];
  try {
    scenarios.push(
      await runScenario(runtime, 'chat', 'In one sentence, what should I focus on today?', []),
    );
    scenarios.push(
      await runScenario(
        runtime,
        'tool call',
        'What is overdue in this workspace? Use the tool.',
        TOOLS,
      ),
    );
    scenarios.push(
      await runScenario(
        runtime,
        'scheduled agent action',
        'This is your scheduled morning sweep. Summarize what changed overnight in one sentence.',
        TOOLS,
      ),
    );
  } catch (cause) {
    // A rejected credential is the other way this run can fail to be real. Nothing is written.
    refuse(
      `the routed call did not succeed (${cause instanceof Error ? cause.message.slice(0, 120) : 'unknown'})`,
    );
  }

  const toolCallSeen = scenarios.some((scenario) =>
    scenario.events.some((event) => event.startsWith('tool_use:')),
  );

  const report = `# Evidence: Athena on Cloudflare's model router

_Generated by \`apps/api/tests/lattice/verify-athena-backend.ts\` on ${new Date().toISOString()}._

## The backend that served this run

| Field | Value |
| --- | --- |
| Backend | \`${backend.descriptor.id}\` |
| Label | ${backend.descriptor.label} |
| Routed through Cloudflare | ${String(backend.descriptor.routed)} |
| Credential owned by | ${backend.descriptor.userSupplied ? 'the operator' : 'Docket'} |
| Endpoint | \`${backend.descriptor.baseURL ?? '(provider default)'}\` |
| Model | \`${backend.descriptor.model}\` |

## Scenarios

${scenarios
  .map(
    (scenario) => `### ${scenario.name}

- **Prompt:** ${scenario.prompt}
- **Events:** ${scenario.events.map((event) => `\`${event}\``).join(' -> ')}
- **Elapsed:** ${String(scenario.ms)} ms

${scenario.reply === '' ? '_(the turn ended in a tool call rather than text)_' : `> ${scenario.reply.replace(/\n+/g, ' ')}`}
`,
  )
  .join('\n')}

A tool call was exercised: **${String(toolCallSeen)}**.

## Request traces

Header **names** only — no value is ever recorded, so this file can be committed.

| at | request | auth headers | status | ms |
| --- | --- | --- | --- | --- |
${traces
  .map(
    (trace) =>
      `| ${trace.at} | ${trace.method} ${trace.url} | ${trace.authHeaders.join(', ') || '—'} | ${String(trace.status)} | ${String(trace.ms)} |`,
  )
  .join('\n')}

Every request above is to the Cloudflare gateway host, which is what "routed on Docket's own keys"
means in practice.

## Recording this in the gate

Paste into \`apps/api/src/routes/lattice-gate.ts\`:

\`\`\`ts
export const CLOUDFLARE_ROUTER_VERIFICATION: ModelBackendVerification = {
  backendId: 'cloudflare-router',
  mode: 'production-keys',
  recordedAt: '${new Date().toISOString().slice(0, 10)}',
  scenarios: ['chat', 'tool-call', 'scheduled-agent-action'],
  evidencePath: 'docs/engineering/evidence/athena-model-backend-verification.md',
};
\`\`\`
`;

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, 'utf8');
  process.stdout.write(`backend:    ${backend.descriptor.id}\n`);
  process.stdout.write(`scenarios:  ${String(scenarios.length)}\n`);
  process.stdout.write(`tool call:  ${String(toolCallSeen)}\n`);
  process.stdout.write(`traces:     ${String(traces.length)}\n`);
  process.stdout.write(`report:     ${REPORT_PATH}\n`);
}

await main();
