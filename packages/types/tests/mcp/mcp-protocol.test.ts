/**
 * The MCP extension protocol constants and predicates.
 *
 * @remarks
 * `@docket/types` is isomorphic and has no filesystem, so the cross-check against the committed
 * specification copies lives in `packages/integrations/tests/mcp/mcp-spec-vocabulary.test.ts`,
 * which reads `docs/engineering/specs/vendor/` directly. What is asserted HERE is the behaviour
 * these modules add on top of the constants: which statuses are terminal, which mean work is
 * still live, and how a per-request capability declaration is read out of untrusted JSON.
 */
import { describe, expect, it } from 'vitest';

import {
  isUiResourceUri,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_TASKS_EXTENSION,
  MCP_TASKS_REQUIRED_CAPABILITY_DATA,
  MCP_TASK_STATUSES,
  MCP_TERMINAL_TASK_STATUSES,
  MCP_UI_DISPLAY_MODES,
  MCP_UI_EXTENSION,
  MCP_UI_PROXIED_METHODS,
  declaresTasksExtension,
  isLiveTaskStatus,
  isTerminalTaskStatus,
} from '../../src';

describe('MCP Apps protocol', () => {
  it('recognises the reserved resource scheme and nothing else', () => {
    expect(isUiResourceUri('ui://acme/dashboard')).toBe(true);
    expect(isUiResourceUri('https://acme/dashboard')).toBe(false);
    expect(isUiResourceUri('docket://task/1')).toBe(false);
  });

  it('admits only the standard MCP methods the view surface section lists', () => {
    // The spec's "Standard MCP Messages" section is exhaustive; a host refuses everything else.
    expect(Object.values(MCP_UI_PROXIED_METHODS).sort()).toEqual([
      'notifications/message',
      'ping',
      'resources/read',
      'tools/call',
    ]);
  });

  it('lists the display modes in the published order', () => {
    expect(MCP_UI_DISPLAY_MODES).toEqual(['inline', 'fullscreen', 'pip']);
  });
});

describe('MCP Tasks protocol', () => {
  it('marks exactly completed, failed, and cancelled as terminal', () => {
    expect([...MCP_TERMINAL_TASK_STATUSES]).toEqual(['completed', 'failed', 'cancelled']);
    for (const status of MCP_TASK_STATUSES) {
      expect(isTerminalTaskStatus(status)).toBe(
        (MCP_TERMINAL_TASK_STATUSES as readonly string[]).includes(status),
      );
    }
  });

  it('treats working and input_required as live, and nothing else', () => {
    // This predicate decides what may be modelled as an MCP task at all: work in progress or
    // pending execution. `input_required` counts — the work is started and waiting on the caller.
    expect(MCP_TASK_STATUSES.filter(isLiveTaskStatus)).toEqual(['working', 'input_required']);
  });

  it('names the extension in the capability payload a refusal carries', () => {
    expect(MCP_TASKS_REQUIRED_CAPABILITY_DATA.requiredCapabilities.extensions).toHaveProperty(
      MCP_TASKS_EXTENSION,
    );
  });

  it('detects the per-request capability declaration the spec requires', () => {
    expect(
      declaresTasksExtension({
        name: 'run_agent',
        _meta: {
          [MCP_CLIENT_CAPABILITIES_META_KEY]: { extensions: { [MCP_TASKS_EXTENSION]: {} } },
        },
      }),
    ).toBe(true);
  });

  it('reads a missing or malformed declaration as "no", never as a crash', () => {
    // Every field on this path is attacker-controlled JSON. The correct answer to nonsense is the
    // synchronous result shape, which means `false`.
    expect(declaresTasksExtension(undefined)).toBe(false);
    expect(declaresTasksExtension(null)).toBe(false);
    expect(declaresTasksExtension('nope')).toBe(false);
    expect(declaresTasksExtension({})).toBe(false);
    expect(declaresTasksExtension({ _meta: null })).toBe(false);
    expect(declaresTasksExtension({ _meta: 'x' })).toBe(false);
    expect(declaresTasksExtension({ _meta: { [MCP_CLIENT_CAPABILITIES_META_KEY]: null } })).toBe(
      false,
    );
    expect(declaresTasksExtension({ _meta: { [MCP_CLIENT_CAPABILITIES_META_KEY]: {} } })).toBe(
      false,
    );
    expect(
      declaresTasksExtension({
        _meta: { [MCP_CLIENT_CAPABILITIES_META_KEY]: { extensions: 'yes' } },
      }),
    ).toBe(false);
    // A declaration for a DIFFERENT extension is not a task declaration.
    expect(
      declaresTasksExtension({
        _meta: { [MCP_CLIENT_CAPABILITIES_META_KEY]: { extensions: { [MCP_UI_EXTENSION]: {} } } },
      }),
    ).toBe(false);
  });
});
