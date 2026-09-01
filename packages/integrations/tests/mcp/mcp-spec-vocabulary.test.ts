/**
 * Every protocol name Docket uses, checked against the committed specification text.
 *
 * @remarks
 * `domain packages` holds one spelling of each method, status, and capability key so the two sides
 * of each bridge cannot drift from each other. This suite is what stops them drifting from the
 * SPEC: each name is asserted to appear in the verbatim copies under
 * `docs/engineering/specs/vendor/`. It lives here rather than in `domain packages` because that
 * package is isomorphic and deliberately has no filesystem.
 *
 * A test that restated the literals would be a tautology. Every assertion below reads the
 * published text.
 */
import { describe, expect, it } from 'vitest';

import {
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_COMPLETE_RESULT_TYPE,
  MCP_INTERNAL_ERROR,
  MCP_INVALID_PARAMS,
  MCP_MISSING_CLIENT_CAPABILITY,
  MCP_TASKS_EXTENSION,
  MCP_TASK_METHODS,
  MCP_TASK_NOTIFICATIONS,
  MCP_TASK_RESULT_TYPE,
  MCP_TASK_STATUSES,
  MCP_TERMINAL_TASK_STATUSES,
} from '../../src/contracts/mcp-tasks';
import {
  MCP_UI_DISPLAY_MODES,
  MCP_UI_EXTENSION,
  MCP_UI_METHODS,
  MCP_UI_META_KEY,
  MCP_UI_MIME_TYPE,
  MCP_UI_PROTOCOL_VERSION,
  MCP_UI_PROXIED_METHODS,
  MCP_UI_SCHEME,
} from '../../src/contracts/mcp-apps';

import { readVendored } from './mcp-apps-conformance';

const APPS_SPEC = readVendored('mcp-apps-2026-01-26.mdx');
const APPS_TYPES = readVendored('mcp-apps-2026-01-26.spec.types.txt');
const TASKS_SPEC = readVendored('mcp-tasks-draft.md');

describe('MCP Apps vocabulary', () => {
  it('spells every method exactly as the published type source does', () => {
    for (const method of Object.values(MCP_UI_METHODS)) {
      expect(APPS_TYPES, `${method} is not a method the spec exports`).toContain(`"${method}"`);
    }
  });

  it('proxies only methods the standard-messages section names', () => {
    for (const method of Object.values(MCP_UI_PROXIED_METHODS)) {
      expect(APPS_SPEC, `${method} is not in the view surface`).toContain(method);
    }
  });

  it('carries the version, extension id, mimeType, scheme, and meta key the spec reserves', () => {
    expect(APPS_TYPES).toContain(`LATEST_PROTOCOL_VERSION = "${MCP_UI_PROTOCOL_VERSION}"`);
    expect(APPS_SPEC).toContain(`This extension is identified as: \`${MCP_UI_EXTENSION}\``);
    expect(APPS_SPEC).toContain(MCP_UI_MIME_TYPE);
    expect(APPS_SPEC).toContain(`The resource prefix \`${MCP_UI_SCHEME}\` will be reserved`);
    expect(APPS_SPEC).toContain(`_meta.${MCP_UI_META_KEY}`);
  });

  it('lists the display modes the spec defines, in its order', () => {
    expect(APPS_TYPES).toContain(
      `McpUiDisplayMode = ${MCP_UI_DISPLAY_MODES.map((mode) => `"${mode}"`).join(' | ')}`,
    );
  });
});

describe('MCP Tasks vocabulary', () => {
  it('spells every method and notification exactly as the published spec does', () => {
    for (const method of Object.values(MCP_TASK_METHODS)) {
      expect(TASKS_SPEC, `${method} is not a method the spec defines`).toContain(`"${method}"`);
    }
    for (const notification of Object.values(MCP_TASK_NOTIFICATIONS)) {
      expect(TASKS_SPEC, `${notification} is not defined`).toContain(`"${notification}"`);
    }
  });

  it('carries the extension id, discriminators, and capability meta key the spec reserves', () => {
    expect(TASKS_SPEC).toContain(`This extension is identified as: \`${MCP_TASKS_EXTENSION}\``);
    expect(TASKS_SPEC).toContain(`The result-discriminator value \`"${MCP_TASK_RESULT_TYPE}"\``);
    expect(TASKS_SPEC).toContain(`"resultType": "${MCP_COMPLETE_RESULT_TYPE}"`);
    expect(TASKS_SPEC).toContain(MCP_CLIENT_CAPABILITIES_META_KEY);
  });

  it('uses the error codes the spec assigns', () => {
    expect(TASKS_SPEC).toContain(
      `\`${String(MCP_MISSING_CLIENT_CAPABILITY)}\` (Missing Required Client Capability)`,
    );
    expect(TASKS_SPEC).toContain(`\`${String(MCP_INVALID_PARAMS)}\` (Invalid params)`);
    expect(TASKS_SPEC).toContain(`\`${String(MCP_INTERNAL_ERROR)}\` (Internal error)`);
  });

  it('lists every status the spec defines, and only those three are terminal', () => {
    for (const status of MCP_TASK_STATUSES) {
      expect(TASKS_SPEC, `${status} is not a status the spec defines`).toContain(`\`${status}\``);
    }
    // The spec's own state diagram names the terminal set; read it rather than restate it.
    const note = /note right of terminal([\s\S]*?)end note/.exec(TASKS_SPEC)?.[1] ?? '';
    expect(note).not.toBe('');
    for (const status of MCP_TASK_STATUSES) {
      const terminal = (MCP_TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
      expect(note.includes(`- ${status}`), `${status} terminal?`).toBe(terminal);
    }
  });
});
