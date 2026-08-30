/**
 * The MCP Apps conformance matrix: extraction from the committed spec, plus Docket's claims.
 *
 * @remarks
 * Two halves that must agree:
 *
 * 1. {@link extractSpecSurface} reads `docs/engineering/specs/vendor/` — the verbatim copies of
 *    the published specification and its type source — and derives the protocol surface from the
 *    text. Nothing here is typed from memory; if upstream adds a method, this picks it up on the
 *    next run and the gate goes red until someone implements it.
 * 2. {@link CONFORMANCE_CLAIMS} is Docket's answer: for each surface item, the module that
 *    implements it or intentionally omits it, and the test that proves the product claim.
 *
 * The gate in `mcp-apps-conformance.test.ts` fails when the two disagree in either direction — an
 * unclaimed spec item, or a claim for something the spec does not define.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository-root-relative path to the vendored spec directory. */
export const VENDOR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/engineering/specs/vendor',
);

/** The provenance record committed alongside the vendored copies. */
export interface SpecSources {
  readonly retrievedAt: string;
  readonly files: Readonly<
    Record<string, { url: string; version: string; sha256: string; retrievedAt: string }>
  >;
  readonly extensions: Readonly<
    Record<string, { version: string; landingPage: string; specFile: string; typesFile: string }>
  >;
}

/** Read `sources.json` from the vendored spec directory. */
export function readSpecSources(): SpecSources {
  return JSON.parse(readFileSync(join(VENDOR_DIR, 'sources.json'), 'utf8')) as SpecSources;
}

/** Read one vendored file verbatim. */
export function readVendored(name: string): string {
  return readFileSync(join(VENDOR_DIR, name), 'utf8');
}

/** One thing the specification defines that a host must account for. */
export interface SpecSurfaceItem {
  /** `method` | `notification` | `host-capability` | `app-capability` | `meta` | `convention`. */
  readonly kind: SpecSurfaceKind;
  /** The identifier as it appears in the spec. */
  readonly name: string;
}

/** The categories the matrix groups the surface into. */
export type SpecSurfaceKind =
  'method' | 'notification' | 'host-capability' | 'app-capability' | 'meta' | 'convention';

/** Extract the block of an `interface Name { … }` declaration from a TypeScript source. */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`Spec type source has no interface ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
    }
  }
  throw new Error(`Unterminated interface ${name}`);
}

/** Top-level property names of an interface body, ignoring nested objects and comments. */
function topLevelProperties(body: string): readonly string[] {
  const names: string[] = [];
  let depth = 0;
  let inBlockComment = false;
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    if (depth === 0) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(trimmed);
      if (match?.[1]) names.push(match[1]);
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

/**
 * Derive the full protocol surface from the committed spec copies.
 *
 * @remarks
 * Method and notification names come from the `*_METHOD` constants in the published type source,
 * which is the spec's own machine-readable list, cross-checked against every `ui/…` string that
 * appears in the prose so a method documented but not exported still shows up. Capability fields
 * come from the two capability interfaces. Meta keys and resource conventions are the handful of
 * literals the prose declares reserved.
 *
 * @returns every item a conforming host must account for.
 */
export function extractSpecSurface(): readonly SpecSurfaceItem[] {
  const types = readVendored('mcp-apps-2026-01-26.spec.types.txt');
  const prose = readVendored('mcp-apps-2026-01-26.mdx');

  const declared = new Set<string>();
  // The spec's own machine-readable list: the exported `*_METHOD` constants.
  for (const match of types.matchAll(/=\s*"(ui\/[a-z0-9/-]+)"/g)) {
    if (match[1] !== undefined) declared.add(match[1]);
  }
  // Cross-checked against every string the prose actually uses as a JSON-RPC `method` value, so a
  // method documented but never exported still shows up. Matching on the `method:` position (not
  // on backticks) is what keeps rejected alternatives out — the Rationale section discusses a
  // `ui/visibility` key that was considered and dropped, and it is not part of the protocol.
  for (const match of prose.matchAll(/"?method"?:\s*"(ui\/[a-z0-9/-]+)"/g)) {
    if (match[1] !== undefined) declared.add(match[1]);
  }

  const items: SpecSurfaceItem[] = [];
  for (const name of [...declared].sort()) {
    items.push({ kind: name.includes('/notifications/') ? 'notification' : 'method', name });
  }

  // Standard MCP methods the spec's "Standard MCP Messages" section admits into the view surface.
  for (const name of ['tools/call', 'resources/read', 'notifications/message', 'ping']) {
    items.push({ kind: name.startsWith('notifications/') ? 'notification' : 'method', name });
  }

  for (const field of topLevelProperties(interfaceBody(types, 'McpUiHostCapabilities'))) {
    items.push({ kind: 'host-capability', name: field });
  }
  for (const field of topLevelProperties(interfaceBody(types, 'McpUiAppCapabilities'))) {
    items.push({ kind: 'app-capability', name: field });
  }

  items.push(
    { kind: 'meta', name: '_meta.ui.resourceUri' },
    { kind: 'meta', name: '_meta.ui.visibility' },
    { kind: 'meta', name: '_meta.ui.csp' },
    { kind: 'meta', name: '_meta.ui.permissions' },
    { kind: 'meta', name: '_meta.ui.domain' },
    { kind: 'meta', name: '_meta.ui.prefersBorder' },
    { kind: 'meta', name: 'capabilities.extensions["io.modelcontextprotocol/ui"]' },
    { kind: 'convention', name: 'ui:// resource scheme' },
    { kind: 'convention', name: 'text/html;profile=mcp-app mimeType' },
    { kind: 'convention', name: 'iframe sandbox' },
    { kind: 'convention', name: 'restrictive default CSP' },
    { kind: 'convention', name: 'sandbox proxy on a separate origin' },
    { kind: 'convention', name: 'protocolVersion 2026-01-26' },
  );

  return items;
}

/** What Docket claims about one surface item. */
export interface ConformanceClaim {
  /** The module that implements it. */
  readonly implementation: string;
  /** The test that exercises it, as `file :: test name`. */
  readonly test: string;
  /** Why this row is what it is, when the reason is not obvious from the two paths. */
  readonly note?: string;
}

/**
 * Docket's implementation and test for every item the spec defines.
 *
 * @remarks
 * There is deliberately no `status` column. Each item must name an implemented handler or a
 * capability gate that intentionally omits unsupported product surface, plus a proving test.
 */
export const CONFORMANCE_CLAIMS: Readonly<Record<string, ConformanceClaim>> = {
  'ui/initialize': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: createMcpAppHost',
    test: 'mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext',
  },
  'ui/notifications/initialized': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: receive',
    test: 'mcp-apps-host.test.ts :: posts nothing to the view before ui/notifications/initialized arrives',
  },
  'ui/notifications/tool-input': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: deliverToolInput',
    test: 'mcp-apps-host.test.ts :: carries the tool arguments on ui/notifications/tool-input',
  },
  'ui/notifications/tool-input-partial': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: deliverToolInputPartial',
    test: 'mcp-apps-host.test.ts :: stops streaming partial arguments once the complete set is sent',
  },
  'ui/notifications/tool-result': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: deliverToolResult',
    test: 'mcp-apps-host.test.ts :: never posts tool-result before tool-input, even when only the result is delivered',
  },
  'ui/notifications/tool-cancelled': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: deliverToolCancelled',
    test: 'mcp-apps-host.test.ts :: tells the view when the tool was cancelled',
  },
  'ui/notifications/host-context-changed': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: updateHostContext',
    test: 'mcp-apps-host.test.ts :: restyles in place: a theme change is a partial host-context patch, not a reload',
  },
  'ui/open-link': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge.onopenlink',
    test: 'mcp-apps-host.test.ts :: opens a link and answers with an empty result',
  },
  'ui/download-file': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
    note: 'Accounted for by omission: Docket exposes no browser download adapter, so the capability and handler are absent.',
  },
  'ui/message': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge.onmessage',
    test: 'mcp-apps-host.test.ts :: posts a ui/message into the conversation',
  },
  'ui/update-model-context': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-host.test.ts :: does not serve draft model-context updates',
    note: 'Accounted for by omission because stable Docket does not expose model-context mutation to apps.',
  },
  'ui/request-display-mode': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge.onrequestdisplaymode',
    test: 'mcp-apps-host.test.ts :: reports the display mode actually applied, not the one requested',
  },
  'ui/notifications/size-changed': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge.onsizechange',
    test: 'mcp-apps-host.test.ts :: reports valid size changes',
  },
  'ui/notifications/request-teardown': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: requestteardown listener',
    test: 'mcp-apps-official-compat.test.ts :: turns an app teardown request into the same graceful teardown handshake before removal',
  },
  'ui/resource-teardown': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: requestTeardown',
    test: 'mcp-apps-host.test.ts :: asks the view to tear down and waits for its answer',
  },
  'ui/notifications/sandbox-proxy-ready': {
    implementation: 'packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument',
    test: 'mcp-apps-sandbox.test.ts :: announces itself to the host as soon as it loads',
  },
  'ui/notifications/sandbox-resource-ready': {
    implementation: 'packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument',
    test: 'mcp-apps-sandbox.test.ts :: renders the document it is handed under the policy it is handed',
  },
  'tools/call': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge.oncalltool',
    test: 'mcp-apps-host.test.ts :: executes an authorized tool and returns the result with the matching id',
    note: 'Out-of-scope tools receive a JSON-RPC error naming the tool, never a silent success.',
  },
  'resources/read': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
    note: 'Accounted for by omission because this browser adapter does not proxy resources/read.',
  },
  'notifications/message': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
    note: 'Accounted for by omission because the browser adapter does not expose app logging.',
  },
  ping: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: receive',
    test: 'mcp-apps-host.test.ts :: answers ping',
  },
  'host-capability:experimental': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
    note: 'Accounted for by omission because Docket exposes no experimental host features.',
  },
  'host-capability:openLinks': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext',
  },
  'host-capability:downloadFile': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
  },
  'host-capability:serverTools': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext',
  },
  'host-capability:serverResources': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
  },
  'host-capability:logging': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
  },
  'host-capability:sandbox': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-host.test.ts :: adds exactly the origins the resource declared and nothing else',
  },
  'host-capability:updateModelContext': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
  },
  'host-capability:message': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-host.test.ts :: posts a ui/message into the conversation',
  },
  'host-capability:sampling': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
    note: 'Accounted for by omission because Docket does not let embedded apps drive model sampling.',
  },
  'app-capability:experimental': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge',
    test: 'mcp-apps-conformance.test.ts :: every app capability the spec defines survives the handshake',
  },
  'app-capability:tools': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge',
    test: 'mcp-apps-conformance.test.ts :: every app capability the spec defines survives the handshake',
  },
  'app-capability:availableDisplayModes': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: AppBridge',
    test: 'mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext',
  },
  'meta:_meta.ui.resourceUri': {
    implementation: 'apps/api/src/mcp/apps/index.ts :: widgetMeta',
    test: 'apps/api/tests/mcp/mcp-apps.test.ts :: carries the linkage under the stable spec key as well as the extension id',
  },
  'meta:_meta.ui.visibility': {
    implementation: 'apps/api/src/mcp/apps/index.ts :: widgetMeta',
    test: 'apps/api/tests/mcp/mcp-apps.test.ts :: keeps semantic tools model-visible while confining legacy get to app callers',
  },
  'meta:_meta.ui.csp': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: buildViewCsp',
    test: 'mcp-apps-host.test.ts :: adds exactly the origins the resource declared and nothing else',
  },
  'meta:_meta.ui.permissions': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: buildViewPermissionsAllow',
    test: 'mcp-apps-host.test.ts :: grants only the permissions the resource asked for',
  },
  'meta:_meta.ui.domain': {
    implementation: 'packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument',
    test: 'mcp-apps-sandbox.test.ts :: accepts messages only from the host origin it was built for',
    note: 'Honoured as the host-controlled proxy origin. Per the spec this field is host-dependent; Docket serves every view from its own API-origin proxy rather than minting a per-resource subdomain.',
  },
  'meta:_meta.ui.prefersBorder': {
    implementation: 'apps/web/src/components/athena/mcp-app-view.tsx :: McpAppView',
    test: 'apps/web/tests/athena/mcp-app-view.test.tsx :: draws a visible boundary only when the resource explicitly prefers one',
  },
  'meta:capabilities.extensions["io.modelcontextprotocol/ui"]': {
    implementation: 'packages/integrations/src/mcp-connector.ts :: MCP_UI_CLIENT_CAPABILITY',
    test: 'mcp-apps-conformance.test.ts :: declares the ui extension with the profile mimeType',
  },
  'convention:ui:// resource scheme': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: isRenderableUiResource',
    test: 'mcp-apps-host.test.ts :: recognises only ui:// documents served with the profile mimeType',
  },
  'convention:text/html;profile=mcp-app mimeType': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: isRenderableUiResource',
    test: 'mcp-apps-host.test.ts :: recognises only ui:// documents served with the profile mimeType',
  },
  'convention:iframe sandbox': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: MCP_APP_VIEW_SANDBOX',
    test: 'mcp-apps-host.test.ts :: never grants the view an origin',
  },
  'convention:restrictive default CSP': {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: buildViewCsp',
    test: 'mcp-apps-host.test.ts :: builds a deny-all CSP when the resource declares nothing',
  },
  'convention:sandbox proxy on a separate origin': {
    implementation: 'apps/api/src/mcp/apps/sandbox.ts :: mcpAppSandboxHandler',
    test: 'apps/api/tests/mcp/mcp-apps-sandbox.test.ts :: serves the proxy from the API origin under its own policy',
  },
  'convention:protocolVersion 2026-01-26': {
    implementation: 'packages/types/src/mcp-apps.ts :: MCP_UI_PROTOCOL_VERSION',
    test: 'mcp-apps-conformance.test.ts :: speaks the version the committed spec publishes',
  },
};

/** The key a surface item is claimed under. */
export function claimKey(item: SpecSurfaceItem): string {
  return item.kind === 'method' || item.kind === 'notification'
    ? item.name
    : `${item.kind}:${item.name}`;
}

/**
 * Render the conformance matrix as Markdown.
 *
 * @param sources - The provenance record for the committed spec copies.
 * @param surface - The extracted surface.
 * @returns the document written to `docs/engineering/specs/mcp-apps-conformance.md`.
 */
export function renderConformanceMatrix(
  sources: SpecSources,
  surface: readonly SpecSurfaceItem[],
): string {
  const extension = sources.extensions['io.modelcontextprotocol/ui'];
  if (!extension) throw new Error('sources.json does not record the ui extension');
  const groups: readonly { kind: SpecSurfaceKind; heading: string }[] = [
    { kind: 'method', heading: 'Requests' },
    { kind: 'notification', heading: 'Notifications' },
    { kind: 'host-capability', heading: 'Host capabilities' },
    { kind: 'app-capability', heading: 'App capabilities' },
    { kind: 'meta', heading: '`_meta` keys and capability declaration' },
    { kind: 'convention', heading: 'Resource and security conventions' },
  ];

  const lines: string[] = [
    '<!-- GENERATED FILE. Regenerate with:',
    '     pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts -->',
    '',
    '# MCP Apps conformance matrix',
    '',
    `**Extension:** \`io.modelcontextprotocol/ui\`  `,
    `**Version, as published by the source:** \`${extension.version}\`  `,
    `**Source:** ${extension.landingPage}  `,
    `**Spec copy:** \`docs/engineering/specs/vendor/${extension.specFile}\`  `,
    `**Retrieved:** ${sources.retrievedAt}`,
    '',
    'Every row below is derived from the committed copy of the specification, not from memory.',
    'Each item names either an implemented handler or an intentional capability omission, and a',
    'test that proves the product claim. `mcp-apps-conformance.test.ts` fails when the extracted',
    'surface contains an item the matrix does not account for.',
    '',
  ];

  for (const group of groups) {
    const items = surface.filter((item) => item.kind === group.kind);
    if (items.length === 0) continue;
    lines.push(`## ${group.heading}`, '', '| Item | Host handler | Test |', '| --- | --- | --- |');
    for (const item of items) {
      const claim = CONFORMANCE_CLAIMS[claimKey(item)];
      if (!claim) throw new Error(`No conformance claim for ${claimKey(item)}`);
      const note = claim.note ? `<br>_${claim.note}_` : '';
      lines.push(`| \`${item.name}\` | \`${claim.implementation}\`${note} | \`${claim.test}\` |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
