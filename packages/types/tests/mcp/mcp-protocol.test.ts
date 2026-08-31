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
  MCP_APP_PRESENTATION_MAX_BYTES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_TASKS_EXTENSION,
  MCP_TASKS_REQUIRED_CAPABILITY_DATA,
  MCP_TASK_STATUSES,
  MCP_TERMINAL_TASK_STATUSES,
  MCP_UI_DISPLAY_MODES,
  MCP_UI_EXTENSION,
  MCP_UI_MIME_TYPE,
  MCP_UI_PROXIED_METHODS,
  MCP_APP_MODEL_CONTEXT_MAX_BYTES,
  declaresTasksExtension,
  isLiveTaskStatus,
  isTerminalTaskStatus,
  parseMcpAppModelContext,
  parseMcpAppPresentation,
} from '../../src';

function validPresentation(): Record<string, unknown> {
  return {
    connectionId: 'connection-1',
    serverName: 'Official map server',
    tool: 'show_map',
    arguments: {
      location: 'Las Vegas',
      filters: ['open', { limit: 2 }],
    },
    result: {
      content: [{ type: 'text', text: 'Map ready' }],
      structuredContent: { center: [-115.1398, 36.1699] },
    },
    resource: {
      uri: 'ui://map/main',
      mimeType: MCP_UI_MIME_TYPE,
      text: '<main>Map</main>',
      meta: {
        prefersBorder: true,
        csp: {
          connectDomains: ['https://api.example.com'],
          resourceDomains: ['https://cdn.example.com'],
        },
        permissions: { clipboardWrite: {} },
      },
    },
  };
}

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

  it('retains a valid presentation as a detached JSON-safe snapshot', () => {
    // Catches accepting an object by reference, which would let later activity mutation alter history.
    const input = validPresentation();

    const parsed = parseMcpAppPresentation(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.arguments).not.toBe(input['arguments']);
    expect(parsed?.resource.meta).toEqual({
      prefersBorder: true,
      csp: {
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://cdn.example.com'],
      },
      permissions: { clipboardWrite: {} },
    });
  });

  it('omits empty resource metadata from a retained presentation', () => {
    // Catches manufacturing metadata that the remote MCP App did not declare.
    const input = validPresentation();
    (input['resource'] as Record<string, unknown>)['meta'] = undefined;

    expect(parseMcpAppPresentation(input)?.resource).toEqual({
      uri: 'ui://map/main',
      mimeType: MCP_UI_MIME_TYPE,
      text: '<main>Map</main>',
    });
  });

  it.each([
    ['a null presentation', null],
    ['an array presentation', []],
    ['a missing connection id', { ...validPresentation(), connectionId: undefined }],
    ['a blank connection id', { ...validPresentation(), connectionId: '' }],
    ['a missing server name', { ...validPresentation(), serverName: undefined }],
    ['a blank server name', { ...validPresentation(), serverName: '' }],
    ['a missing tool name', { ...validPresentation(), tool: undefined }],
    ['a blank tool name', { ...validPresentation(), tool: '' }],
    ['array arguments', { ...validPresentation(), arguments: [] }],
    ['an invalid tool result', { ...validPresentation(), result: { content: 'Map ready' } }],
    ['a missing resource', { ...validPresentation(), resource: null }],
    [
      'a non-string resource URI',
      { ...validPresentation(), resource: { uri: 7, mimeType: MCP_UI_MIME_TYPE, text: 'Map' } },
    ],
    [
      'a non-ui resource URI',
      {
        ...validPresentation(),
        resource: { uri: 'https://example.com/map', mimeType: MCP_UI_MIME_TYPE, text: 'Map' },
      },
    ],
    [
      'the wrong resource MIME type',
      {
        ...validPresentation(),
        resource: { uri: 'ui://map/main', mimeType: 'text/html', text: 'Map' },
      },
    ],
    [
      'non-string resource text',
      {
        ...validPresentation(),
        resource: { uri: 'ui://map/main', mimeType: MCP_UI_MIME_TYPE, text: 7 },
      },
    ],
    [
      'invalid resource metadata',
      {
        ...validPresentation(),
        resource: {
          uri: 'ui://map/main',
          mimeType: MCP_UI_MIME_TYPE,
          text: 'Map',
          meta: { csp: { connectDomains: [7] } },
        },
      },
    ],
  ])('rejects %s at the persistence boundary', (_label, input) => {
    // Catches any malformed identity, result, or resource crossing from JSONB into the sandbox.
    expect(parseMcpAppPresentation(input)).toBeNull();
  });

  it('rejects credential-shaped keys anywhere in nested arguments', () => {
    // Catches credential leakage when key punctuation or array nesting changes.
    const input = validPresentation();
    input['arguments'] = { layers: [{ private_key: 'do-not-persist' }] };

    expect(parseMcpAppPresentation(input)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['function', () => 'unsafe'],
    ['symbol', Symbol('unsafe')],
    ['infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects a JSON-unsafe %s in presentation arguments', (_label, unsafeValue) => {
    // Catches JSONB coercion silently changing a persisted tool invocation.
    const input = validPresentation();
    input['arguments'] = { unsafeValue };

    expect(parseMcpAppPresentation(input)).toBeNull();
  });

  it('rejects cyclic presentation arguments', () => {
    // Catches cyclic objects escaping credential traversal and crashing JSON serialization.
    const cyclic: Record<string, unknown> = { label: 'cycle' };
    cyclic['self'] = cyclic;
    const input = validPresentation();
    input['arguments'] = { cyclic };

    expect(parseMcpAppPresentation(input)).toBeNull();
  });

  it('rejects a presentation whose serialized snapshot exceeds the storage boundary', () => {
    // Catches oversized HTML crossing the bounded JSONB/activity contract.
    const input = validPresentation();
    (input['resource'] as Record<string, unknown>)['text'] = 'x'.repeat(
      MCP_APP_PRESENTATION_MAX_BYTES,
    );

    expect(parseMcpAppPresentation(input)).toBeNull();
  });
});

describe('widget model-context updates', () => {
  it('retains text blocks joined with any structured content', () => {
    expect(
      parseMcpAppModelContext({
        content: [
          { type: 'text', text: 'the user pinned Dallas' },
          { type: 'text', text: 'and dismissed the alert' },
        ],
        structuredContent: { city: 'Dallas' },
      }),
    ).toEqual({
      text: 'the user pinned Dallas\nand dismissed the alert',
      structuredContent: { city: 'Dallas' },
    });
  });

  it('retains a structured-only update with empty text', () => {
    expect(parseMcpAppModelContext({ structuredContent: { city: 'Dallas' } })).toEqual({
      text: '',
      structuredContent: { city: 'Dallas' },
    });
  });

  it('rejects non-objects, empty updates, and non-array content outright', () => {
    expect(parseMcpAppModelContext(null)).toBeNull();
    expect(parseMcpAppModelContext('context')).toBeNull();
    expect(parseMcpAppModelContext({})).toBeNull();
    expect(parseMcpAppModelContext({ content: [] })).toBeNull();
    expect(parseMcpAppModelContext({ content: 'not-blocks' })).toBeNull();
  });

  it('rejects any non-text block rather than filtering it away', () => {
    expect(
      parseMcpAppModelContext({
        content: [
          { type: 'text', text: 'kept?' },
          { type: 'image', data: 'x', mimeType: 'image/png' },
        ],
      }),
    ).toBeNull();
    expect(parseMcpAppModelContext({ content: [{ type: 'text', text: 7 }] })).toBeNull();
    expect(parseMcpAppModelContext({ content: ['bare string'] })).toBeNull();
  });

  it('rejects credential-shaped keys and payloads over the context cap', () => {
    expect(
      parseMcpAppModelContext({
        content: [{ type: 'text', text: 'fine' }],
        structuredContent: { apiKey: 'sk-forbidden' },
      }),
    ).toBeNull();
    expect(
      parseMcpAppModelContext({
        content: [{ type: 'text', text: 'x'.repeat(MCP_APP_MODEL_CONTEXT_MAX_BYTES + 1) }],
      }),
    ).toBeNull();
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
