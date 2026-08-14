/**
 * The MCP Apps conformance gate.
 *
 * @remarks
 * Three things are checked, and all three have to hold for the matrix to mean anything:
 *
 * 1. The provenance of the committed spec copies — the bytes still hash to what `sources.json`
 *    recorded, so nobody has quietly edited the specification to match the implementation.
 * 2. Coverage — every item extracted from the spec text has a claim, and every claim corresponds
 *    to an item the spec actually defines.
 * 3. Truthfulness of the claims — each row names a test, and that test exists, by name, in the
 *    file the row names. A matrix that cites tests nobody wrote is worse than no matrix.
 *
 * Plus the handful of behavioural assertions the matrix itself cites.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  CONFORMANCE_CLAIMS,
  claimKey,
  extractSpecSurface,
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
  const surface = extractSpecSurface();

  it('extracts a surface that includes every method the spec names', () => {
    const names = new Set(surface.map((item) => item.name));
    for (const method of Object.values(MCP_UI_METHODS)) {
      expect(names, `the spec text does not mention ${method}`).toContain(method);
    }
    // The extraction is doing real work, not returning a hand-written list.
    expect(surface.filter((item) => item.kind === 'method').length).toBeGreaterThan(5);
    expect(surface.filter((item) => item.kind === 'notification').length).toBeGreaterThan(5);
  });

  it('claims every item the spec defines, and claims nothing it does not', () => {
    const keys = surface.map(claimKey);
    const missing = keys.filter((key) => !CONFORMANCE_CLAIMS[key]);
    expect(missing, 'spec items with no implementation claim').toEqual([]);

    const extra = Object.keys(CONFORMANCE_CLAIMS).filter((key) => !keys.includes(key));
    expect(extra, 'claims for things the spec does not define').toEqual([]);
  });

  it('has no row that hedges — every claim names an implementation and a real test', () => {
    for (const [key, claim] of Object.entries(CONFORMANCE_CLAIMS)) {
      expect(claim.implementation, key).toMatch(/\.tsx? :: \S/);
      const [file, testName] = claim.test.split(' :: ');
      expect(testName, key).toBeTruthy();

      const candidates = [
        join(dirname(fileURLToPath(import.meta.url)), file ?? ''),
        join(REPO_ROOT, file ?? ''),
      ];
      const found = candidates.find((path) => existsSync(path));
      expect(found, `${key} cites a test file that does not exist: ${String(file)}`).toBeDefined();
      const source = readFileSync(assertDefined(found), 'utf8');
      expect(source, `${key} cites a test that does not exist: ${String(testName)}`).toContain(
        `'${String(testName)}'`,
      );

      // No row may hedge. The implementation and test columns are structural (a method really is
      // named `tool-input-partial`), so the vocabulary check applies to the prose column, which is
      // the only place a "we'll get to it" could hide.
      const note = (claim.note ?? '').toLowerCase();
      for (const word of ['unimplemented', 'partially', 'deferred', 'todo', 'not yet', 'planned']) {
        expect(note, `${key} hedges with "${word}"`).not.toContain(word);
      }
    }
  });

  it('is committed in the form the generator produces', () => {
    expect(
      existsSync(MATRIX_PATH),
      'run: pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts',
    ).toBe(true);
    expect(readFileSync(MATRIX_PATH, 'utf8')).toBe(
      renderConformanceMatrix(readSpecSources(), surface),
    );
  });
});

describe('claims the matrix cites here', () => {
  it('declares the ui extension with the profile mimeType', () => {
    // The spec makes `mimeTypes` REQUIRED, and requires it to include the profile type.
    expect(MCP_UI_CLIENT_CAPABILITY.mimeTypes).toContain(MCP_UI_MIME_TYPE);
    const prose = readVendored('mcp-apps-2026-01-26.mdx');
    expect(prose).toContain('"mimeTypes": ["text/html;profile=mcp-app"]');
  });

  it('every host capability the spec defines is representable', () => {
    // `experimental` and `sampling` are representable and deliberately not advertised — see their
    // rows. This asserts the two claims are true of the actual advertised set.
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
      updateModelContext: () => undefined,
      sendMessage: () => true,
    });
    void host.receive({
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
      'downloadFile',
      'logging',
      'message',
      'openLinks',
      'sandbox',
      'serverResources',
      'serverTools',
      'updateModelContext',
    ]);
    expect(capabilities['experimental']).toBeUndefined();
    expect(capabilities['sampling']).toBeUndefined();
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
