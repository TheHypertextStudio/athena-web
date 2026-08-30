/**
 * The MCP Apps conformance gate.
 *
 * @remarks
 * Four things are checked, and all four have to hold for the manifest to mean anything:
 *
 * 1. The provenance of the committed spec copies — the bytes still hash to what `sources.json`
 *    recorded, so nobody has quietly edited the specification to match the implementation.
 * 2. Coverage — every uppercase RFC 2119 occurrence has one stable, fingerprinted manifest row.
 * 3. Truthfulness of the claims — each row names a test, and that test exists, by name, in the
 *    file the row names. A matrix that cites tests nobody wrote is worse than no matrix.
 *
 * 4. Optional truthfulness — every advertised capability has an end-to-end test.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LATEST_PROTOCOL_VERSION,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';

import {
  MCP_UI_EXTENSION,
  MCP_UI_META_KEY,
  MCP_UI_METHODS,
  MCP_UI_MIME_TYPE,
  MCP_UI_PROTOCOL_VERSION,
} from '@docket/types';
import { createMcpAppHost, type JsonRpcMessage } from '../../src/mcp-apps-host';
import { MCP_UI_CLIENT_CAPABILITY } from '../../src/mcp-connector';
import {
  ADVERTISED_OPTIONAL_CAPABILITIES,
  NORMATIVE_REQUIREMENTS,
  extractNormativeRequirements,
  readSpecSources,
  readVendored,
  renderConformanceMatrix,
  VENDOR_DIR,
} from './mcp-apps-conformance';
import { assertDefined } from '@docket/test-utils';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MATRIX_PATH = join(REPO_ROOT, 'docs/engineering/specs/mcp-apps-conformance.md');

describe('committed specification', () => {
  it('is the text that was published, unedited', () => {
    const sources = readSpecSources();
    for (const [name, record] of Object.entries(sources.files)) {
      const digest = createHash('sha256')
        .update(readFileSync(join(VENDOR_DIR, name)))
        .digest('hex');
      expect(digest, `${name} no longer matches its recorded digest`).toBe(record.sha256);
    }
  });

  it('records a retrieval date and the version identifier its source publishes', () => {
    const sources = readSpecSources();
    expect(sources.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ui = sources.extensions[MCP_UI_EXTENSION];
    expect(ui?.landingPage).toBe('https://apps.extensions.modelcontextprotocol.io/api/');
    // Not invented: this string appears in the spec's own status line.
    expect(ui?.version).toBe('2026-01-26');
    expect(readVendored(ui?.specFile ?? '')).toContain('**Status:** Stable (2026-01-26)');
  });

  it('speaks the version the committed spec publishes', () => {
    const types = readVendored('mcp-apps-2026-01-26.spec.types.txt');
    const published = /LATEST_PROTOCOL_VERSION = "([^"]+)"/.exec(types)?.[1];
    expect(published).toBeDefined();
    expect(MCP_UI_PROTOCOL_VERSION).toBe(published);
    expect(MCP_UI_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
    expect(MCP_UI_MIME_TYPE).toBe(RESOURCE_MIME_TYPE);
  });

  it('uses the mimeType, scheme, meta key, and extension id the spec reserves', () => {
    const prose = readVendored('mcp-apps-2026-01-26.mdx');
    expect(prose).toContain(MCP_UI_MIME_TYPE);
    expect(prose).toContain('The resource prefix `ui://` will be reserved for MCP Apps');
    expect(prose).toContain(`The label \`${MCP_UI_EXTENSION}\` is reserved`);
    // The stable spec's tool/resource linkage key is `_meta.ui`, not the extension id.
    expect(prose).toContain(`_meta.${MCP_UI_META_KEY}`);
  });
});

describe('conformance matrix', () => {
  const requirements = extractNormativeRequirements();

  it('accounts for every RFC 2119 requirement rather than only protocol symbols', () => {
    expect(requirements).toHaveLength(81);
    expect(requirements.some((requirement) => requirement.level === 'MUST NOT')).toBe(true);
    expect(new Set(NORMATIVE_REQUIREMENTS.map((requirement) => requirement.role))).toEqual(
      new Set(['host', 'sandbox', 'server', 'view']),
    );
    expect(requirements.map((requirement) => requirement.sourceFingerprint).sort()).toEqual(
      NORMATIVE_REQUIREMENTS.map((requirement) => requirement.sourceFingerprint).sort(),
    );
  });

  it('gives every applicable requirement implementation and named behavioral evidence', () => {
    const ids = new Set<string>();
    for (const requirement of NORMATIVE_REQUIREMENTS) {
      expect(ids.has(requirement.id), `duplicate stable id ${requirement.id}`).toBe(false);
      ids.add(requirement.id);
      expect(requirement.implementation, requirement.id).toMatch(/\.tsx? :: \S/);
      if (requirement.applicability === 'not-applicable') {
        expect(
          requirement.reason?.length,
          `${requirement.id} needs a concrete reason`,
        ).toBeGreaterThan(20);
      }
      const [file, testName] = requirement.test.split(' :: ');
      expect(testName, requirement.id).toBeTruthy();

      const candidates = [
        join(dirname(fileURLToPath(import.meta.url)), file ?? ''),
        join(REPO_ROOT, file ?? ''),
      ];
      const found = candidates.find((path) => existsSync(path));
      expect(
        found,
        `${requirement.id} cites a test file that does not exist: ${String(file)}`,
      ).toBeDefined();
      const source = readFileSync(assertDefined(found), 'utf8');
      expect(
        source,
        `${requirement.id} cites a test that does not exist: ${String(testName)}`,
      ).toContain(`'${String(testName)}'`);
    }
  });

  it('resolves every implementation responsibility from the repository root', () => {
    for (const requirement of NORMATIVE_REQUIREMENTS) {
      const [file, locator] = requirement.implementation.split(' :: ');
      expect(file, `${requirement.id} needs an implementation file`).toBeTruthy();
      expect(locator, `${requirement.id} needs an implementation locator`).toBeTruthy();

      const implementationPath = resolve(REPO_ROOT, file ?? '');
      const repoRelative = relative(REPO_ROOT, implementationPath);
      expect(
        repoRelative.startsWith('..'),
        `${requirement.id} escapes the repository root: ${String(file)}`,
      ).toBe(false);
      expect(
        existsSync(implementationPath),
        `${requirement.id} cites production code that does not exist: ${String(file)}`,
      ).toBe(true);
      expect(
        readFileSync(implementationPath, 'utf8'),
        `${requirement.id} locator is absent from ${String(file)}: ${String(locator)}`,
      ).toContain(locator);
    }
  });

  it('assigns server and view obligations to Athena production behavior', () => {
    for (const requirement of NORMATIVE_REQUIREMENTS.filter(
      (entry) => entry.applicability === 'applicable',
    )) {
      const [implementationFile] = requirement.implementation.split(' :: ');
      const [testFile] = requirement.test.split(' :: ');
      if (requirement.role === 'server') {
        expect(implementationFile, requirement.id).toMatch(/^apps\/api\/src\/mcp\//);
        expect(testFile, requirement.id).toMatch(/^apps\/api\/tests\/mcp\//);
      }
      if (requirement.role === 'view') {
        expect(implementationFile, requirement.id).toBe('apps/api/src/mcp/apps/runtime.ts');
        expect(testFile, requirement.id).toBe('apps/api/tests/mcp/mcp-app-runtime.test.ts');
      }
      if (requirement.role === 'sandbox' && requirement.id !== 'SANDBOX-001') {
        expect(implementationFile, requirement.id).toBe(
          'packages/integrations/src/mcp-apps-sandbox.ts',
        );
      }
    }
  });

  it('names an existing end-to-end test for every advertised optional capability', () => {
    expect(ADVERTISED_OPTIONAL_CAPABILITIES.map((entry) => entry.capability).sort()).toEqual([
      'displayMode.fullscreen',
      'displayMode.inline',
      'hostContext.sizing',
      'hostContext.theme',
      'message.text',
      'openLinks',
      'sandbox.csp',
      'sandbox.permissions',
      'serverTools',
    ]);
    for (const entry of ADVERTISED_OPTIONAL_CAPABILITIES) {
      const [file, testName] = entry.test.split(' :: ');
      expect(file, `${entry.capability} must cite browser-executed Playwright evidence`).toMatch(
        /^apps\/web\/e2e\/.*\.spec\.ts$/,
      );
      const candidates = [
        join(dirname(fileURLToPath(import.meta.url)), file ?? ''),
        join(REPO_ROOT, file ?? ''),
      ];
      const found = candidates.find((path) => existsSync(path));
      expect(found, `${entry.capability} cites no test file`).toBeDefined();
      expect(readFileSync(assertDefined(found), 'utf8'), entry.capability).toContain(
        `'${String(testName)}'`,
      );
    }
  });

  it('is committed in the form the generator produces', () => {
    expect(
      existsSync(MATRIX_PATH),
      'run: pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts',
    ).toBe(true);
    expect(readFileSync(MATRIX_PATH, 'utf8')).toBe(renderConformanceMatrix(readSpecSources()));
  });
});

describe('claims the matrix cites here', () => {
  it('declares the ui extension with the profile mimeType', () => {
    // The spec makes `mimeTypes` REQUIRED, and requires it to include the profile type.
    expect(MCP_UI_CLIENT_CAPABILITY.mimeTypes).toContain(MCP_UI_MIME_TYPE);
    const prose = readVendored('mcp-apps-2026-01-26.mdx');
    expect(prose).toContain('"mimeTypes": ["text/html;profile=mcp-app"]');
  });

  it('advertises only end-to-end host capabilities', async () => {
    const posted: JsonRpcMessage[] = [];
    const host = createMcpAppHost({
      hostInfo: { name: 'docket', version: '1.0.0' },
      resource: { uri: 'ui://x/y', mimeType: MCP_UI_MIME_TYPE, text: '<html></html>' },
      post: (message) => posted.push(message),
      openLink: () => true,
      downloadFile: () => true,
      callTool: async () => ({ content: [] }),
      readResource: async () => ({}),
      log: () => undefined,
      sendMessage: () => true,
    });
    await host.receive({
      jsonrpc: '2.0',
      id: 1,
      method: MCP_UI_METHODS.initialize,
      params: {
        appInfo: { name: 'v', version: '1' },
        appCapabilities: {},
        protocolVersion: MCP_UI_PROTOCOL_VERSION,
      },
    });
    const capabilities = (posted[0]?.result as { hostCapabilities: Record<string, unknown> })
      .hostCapabilities;
    expect(Object.keys(capabilities).sort()).toEqual([
      'message',
      'openLinks',
      'sandbox',
      'serverTools',
    ]);
    expect(capabilities['downloadFile']).toBeUndefined();
    expect(capabilities['experimental']).toBeUndefined();
    expect(capabilities['logging']).toBeUndefined();
    expect(capabilities['sampling']).toBeUndefined();
    expect(capabilities['serverResources']).toBeUndefined();
    expect(capabilities['updateModelContext']).toBeUndefined();
  });

  it('every app capability the spec defines survives the handshake', async () => {
    const posted: JsonRpcMessage[] = [];
    const host = createMcpAppHost({
      hostInfo: { name: 'docket', version: '1.0.0' },
      resource: { uri: 'ui://x/y', mimeType: MCP_UI_MIME_TYPE, text: '<html></html>' },
      post: (message) => posted.push(message),
    });
    const declared = {
      experimental: { 'acme/streaming': {} },
      tools: { listChanged: true },
      availableDisplayModes: ['inline', 'pip'],
    };
    await host.receive({
      jsonrpc: '2.0',
      id: 1,
      method: MCP_UI_METHODS.initialize,
      params: {
        appInfo: { name: 'v', version: '1' },
        appCapabilities: declared,
        protocolVersion: MCP_UI_PROTOCOL_VERSION,
      },
    });
    expect(host.appCapabilities).toEqual(declared);
  });
});
