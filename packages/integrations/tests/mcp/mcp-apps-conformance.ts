/**
 * Executable normative manifest for the stable MCP Apps specification.
 *
 * @remarks
 * The manifest is keyed by fingerprints of every uppercase RFC 2119 occurrence in the committed
 * `2026-01-26` prose. A protocol-symbol inventory can stay green while normative behavior drifts;
 * this file cannot. Its gate rejects changed spec bytes, missing or extra requirements, missing
 * evidence, invented test names, and optional capabilities without end-to-end coverage.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository-root-relative path to the vendored spec directory. */
export const VENDOR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/engineering/specs/vendor',
);

/** Provenance committed alongside the vendored specifications. */
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

/** Read one vendored specification file verbatim. */
export function readVendored(name: string): string {
  return readFileSync(join(VENDOR_DIR, name), 'utf8');
}

/** The RFC 2119 vocabulary used by the stable prose. */
export type RequirementLevel =
  'MUST' | 'MUST NOT' | 'SHOULD' | 'SHOULD NOT' | 'MAY' | 'REQUIRED' | 'RECOMMENDED';

/** Product role responsible for a normative statement. */
export type RequirementRole = 'host' | 'sandbox' | 'server' | 'view';

/** One normative occurrence extracted directly from the committed spec. */
export interface ExtractedNormativeRequirement {
  readonly sourceHeading: string;
  readonly sourceLine: number;
  readonly sourceText: string;
  readonly sourceFingerprint: string;
  readonly level: RequirementLevel;
}

const REQUIREMENT_PATTERN = /\b(MUST NOT|SHOULD NOT|MUST|SHOULD|MAY|REQUIRED|RECOMMENDED)\b/g;

/** Extract every uppercase RFC 2119 occurrence from the stable specification. */
export function extractNormativeRequirements(): readonly ExtractedNormativeRequirement[] {
  const source = readVendored('mcp-apps-2026-01-26.mdx');
  const requirements: ExtractedNormativeRequirement[] = [];
  let heading = '';
  for (const [index, line] of source.split('\n').entries()) {
    const headingMatch = /^#{1,6}\s+(.+)/.exec(line);
    if (headingMatch?.[1]) heading = headingMatch[1].replace(/<[^>]+>/g, '').trim();
    const sourceText = line.trim().replace(/\s+/g, ' ');
    for (const match of line.matchAll(REQUIREMENT_PATTERN)) {
      const level = match[1] as RequirementLevel;
      const offset = match.index;
      requirements.push({
        sourceHeading: heading,
        sourceLine: index + 1,
        sourceText,
        sourceFingerprint: createHash('sha256')
          .update(`${heading}\n${sourceText}\n${level}\n${offset}`)
          .digest('hex')
          .slice(0, 16),
        level,
      });
    }
  }
  return requirements;
}

/** Named implementation and behavioral-test evidence reused by manifest rows. */
interface Evidence {
  readonly implementation: string;
  readonly test: string;
}

const EVIDENCE = {
  serverResource: {
    implementation: 'apps/api/src/mcp/apps/index.ts :: registerAppResources',
    test: 'apps/api/tests/mcp/mcp-apps.test.ts :: serves a document that can boot with no network at all',
  },
  permissions: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: buildViewPermissionsAllow',
    test: 'mcp-apps-host.test.ts :: grants only the permissions the resource asked for',
  },
  permissionFeatureDetection: {
    implementation: 'apps/api/src/mcp/apps/runtime.ts :: permission-free runtime',
    test: 'apps/api/tests/mcp/mcp-apps.test.ts :: serves a document that can boot with no network at all',
  },
  domainOmission: {
    implementation: 'apps/api/src/mcp/apps/index.ts :: widget resource metadata',
    test: 'apps/web/tests/athena/mcp-app-view.test.tsx :: renders the widget through a proxy on the API origin, not the app origin',
  },
  csp: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: buildViewCsp',
    test: 'mcp-apps-host.test.ts :: adds exactly the origins the resource declared and nothing else',
  },
  capabilityOmission: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: truthful hostCapabilities',
    test: 'mcp-apps-conformance.test.ts :: advertises only end-to-end host capabilities',
  },
  resourceSnapshot: {
    implementation: 'packages/integrations/src/mcp-connector.ts :: captureMcpAppPresentation',
    test: 'mcp-apps-real-connector.test.ts :: snapshots valid base64 widget HTML beside the one raw tool result',
  },
  modelVisibility: {
    implementation: 'apps/api/src/agents/toolbox.ts :: model-visible remote tool catalog',
    test: 'apps/api/tests/agent/toolbox.test.ts :: surfaces absent, model-only, and dual-visible tools while keeping app-only helpers out of the model catalog',
  },
  appVisibility: {
    implementation: 'apps/api/src/mcp/apps/host.ts :: runWidgetTool',
    test: 'apps/api/tests/mcp/mcp-apps-host-routes.test.ts :: refuses a model-only tool when a view asks for it, though the model may call it',
  },
  browserSandbox: {
    implementation: 'apps/web/src/components/athena/mcp-app-view.tsx :: McpAppView',
    test: 'apps/web/tests/athena/mcp-app-view.test.tsx :: gives the proxy an origin and the widget none',
  },
  sandbox: {
    implementation: 'packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument',
    test: 'mcp-apps-sandbox.test.ts :: forwards host messages down to the view and view messages up to the host',
  },
  officialLifecycle: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: createMcpAppHost',
    test: 'mcp-apps-official-compat.test.ts :: interoperates through the official App across the complete stable lifecycle',
  },
  partialInput: {
    implementation: 'packages/integrations/src/mcp-apps-host.ts :: deliverToolInputPartial',
    test: 'mcp-apps-host.test.ts :: stops streaming partial arguments once the complete set is sent',
  },
  clientCapability: {
    implementation: 'packages/integrations/src/mcp-connector.ts :: MCP_UI_CLIENT_CAPABILITY',
    test: 'mcp-apps-conformance.test.ts :: declares the ui extension with the profile mimeType',
  },
  serverFallback: {
    implementation: 'packages/integrations/src/mcp-connector.ts :: textual tool-result fallback',
    test: 'mcp-apps-real-connector.test.ts :: preserves a successful textual result when its app resource cannot be read',
  },
} as const satisfies Readonly<Record<string, Evidence>>;

/** One fully-accounted stable normative requirement. */
export interface NormativeRequirement extends ExtractedNormativeRequirement, Evidence {
  readonly id: string;
  readonly role: RequirementRole;
  readonly applicability: 'applicable' | 'not-applicable';
  readonly reason?: string;
}

const SOURCE_BY_FINGERPRINT = new Map(
  extractNormativeRequirements().map((requirement) => [requirement.sourceFingerprint, requirement]),
);

function defineRequirement(
  id: string,
  sourceFingerprint: string,
  role: RequirementRole,
  applicability: NormativeRequirement['applicability'],
  evidenceKey: keyof typeof EVIDENCE,
  reason?: string,
): NormativeRequirement {
  const source = SOURCE_BY_FINGERPRINT.get(sourceFingerprint);
  if (!source) throw new Error(`${id} no longer matches the vendored stable specification`);
  return {
    ...source,
    id,
    role,
    applicability,
    ...EVIDENCE[evidenceKey],
    ...(reason ? { reason } : {}),
  };
}

/** Stable `2026-01-26` normative requirements manifest. */
export const NORMATIVE_REQUIREMENTS: readonly NormativeRequirement[] = [
  defineRequirement('SERVER-001', '2bfa91d727eff917', 'server', 'applicable', 'serverResource'),
  defineRequirement('SERVER-002', '15999262f0aa84bf', 'server', 'applicable', 'serverResource'),
  defineRequirement('HOST-001', 'b2c8b9d1406c8e83', 'host', 'applicable', 'permissions'),
  defineRequirement(
    'VIEW-001',
    '573c3a0e2874903e',
    'view',
    'not-applicable',
    'permissionFeatureDetection',
    'Athena widgets request no permission-dependent browser API, so feature-detection fallback is not exercised.',
  ),
  defineRequirement(
    'SERVER-003',
    'b9ff1969224cf01f',
    'server',
    'not-applicable',
    'domainOmission',
    'Athena resources do not declare ui.domain; the API-origin sandbox is host-controlled.',
  ),
  defineRequirement('SERVER-004', '5ea525d3c49c6b97', 'server', 'applicable', 'serverResource'),
  defineRequirement('SERVER-005', '177a09f26b8b78ec', 'server', 'applicable', 'serverResource'),
  defineRequirement('SERVER-006', '5c97c7c9edcb1fe5', 'server', 'applicable', 'serverResource'),
  defineRequirement('SERVER-007', '14eb096e92aef753', 'server', 'applicable', 'serverResource'),
  defineRequirement('SERVER-008', '7020222c5779a235', 'server', 'applicable', 'serverResource'),
  defineRequirement('HOST-002', '9fa81c3e52c742c3', 'host', 'applicable', 'csp'),
  defineRequirement('HOST-003', 'fc191c471fc083fb', 'host', 'applicable', 'csp'),
  defineRequirement('HOST-004', '206c1711ff883b57', 'host', 'applicable', 'csp'),
  defineRequirement('HOST-005', '8d8e265b528fc512', 'host', 'applicable', 'csp'),
  defineRequirement(
    'HOST-006',
    '152d4e206d0c7a77',
    'host',
    'not-applicable',
    'capabilityOmission',
    'CSP values are enforced and covered without retaining untrusted provider policy in application logs.',
  ),
  defineRequirement('SERVER-009', '05e8e1269d28eb8c', 'server', 'applicable', 'serverResource'),
  defineRequirement('HOST-007', '4f41cb6c146ea11f', 'host', 'applicable', 'resourceSnapshot'),
  defineRequirement('HOST-008', 'fb67f10142c8bfb5', 'host', 'applicable', 'resourceSnapshot'),
  defineRequirement(
    'SERVER-010',
    '7b9eb959446688a7',
    'server',
    'not-applicable',
    'serverResource',
    'Athena lists its own stable UI resources; it does not exercise the optional omission.',
  ),
  defineRequirement('HOST-009', '6ef0259f9ae24490', 'host', 'applicable', 'modelVisibility'),
  defineRequirement('HOST-010', '8e47217157f2409d', 'host', 'applicable', 'appVisibility'),
  defineRequirement('HOST-011', 'cf5d809524b6c3b9', 'host', 'applicable', 'browserSandbox'),
  defineRequirement('HOST-012', 'f976b1b6db870055', 'host', 'applicable', 'browserSandbox'),
  defineRequirement('SANDBOX-001', 'd7eae745f110fb68', 'sandbox', 'applicable', 'sandbox'),
  defineRequirement('SANDBOX-002', '58048a3c84045329', 'sandbox', 'applicable', 'sandbox'),
  defineRequirement('HOST-013', '915e00d6144c2577', 'host', 'applicable', 'browserSandbox'),
  defineRequirement('SANDBOX-003', 'bd3b0be78ece8419', 'sandbox', 'applicable', 'sandbox'),
  defineRequirement('SANDBOX-004', 'de2ed9663fe73f1c', 'sandbox', 'applicable', 'permissions'),
  defineRequirement('SANDBOX-005', '24822d78b2fdd443', 'sandbox', 'applicable', 'sandbox'),
  defineRequirement('HOST-014', '543f3f9599e303b6', 'host', 'applicable', 'browserSandbox'),
  defineRequirement('SANDBOX-006', 'db3b2162c1b604d8', 'sandbox', 'applicable', 'sandbox'),
  defineRequirement(
    'HOST-015',
    '7acc73cb2cb34705',
    'host',
    'not-applicable',
    'capabilityOmission',
    'Athena forwards only explicitly advertised and authorized stable server methods, not the generic optional channel.',
  ),
  defineRequirement('HOST-016', '101c0d5c3a4201f0', 'host', 'applicable', 'capabilityOmission'),
  defineRequirement(
    'HOST-017',
    '729855eafca085f7',
    'host',
    'not-applicable',
    'capabilityOmission',
    'Athena has no additional approval channel for generic forwarded messages because that optional channel is absent.',
  ),
  defineRequirement('VIEW-002', 'a7bed610ff928163', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-018', 'd90c088450cbe3cc', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-019', 'a913c0bdd3e0363c', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-003', '10fa2a0572b0e08b', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-004', '42ffc1178e4709b0', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-005', '506540c0ef05df46', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-020', '2a15799d4a485092', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-021', '36351519afa4511e', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-022', '83188a959380935f', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-023', 'efe085fad33eb6e6', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-024', '3c2e6540a2f72b08', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-025', '6ffa627842ae6d3e', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement(
    'HOST-026',
    '69f18f2d5080889d',
    'host',
    'not-applicable',
    'capabilityOmission',
    'Text-only ui/message is routed directly to canonical chat; no separate consent mode is advertised.',
  ),
  defineRequirement(
    'VIEW-006',
    '14a2a10748db383a',
    'view',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-027',
    '2a80e3bdfc16b038',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-028',
    '29212344d68dc5d5',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-029',
    '1112f4558cd5dc16',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-030',
    '568f488043c64aed',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-031',
    'df85f74bdbb93555',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement(
    'HOST-032',
    '5273986e39fa6bd4',
    'host',
    'not-applicable',
    'capabilityOmission',
    'ui/update-model-context is unsupported and updateModelContext is not advertised.',
  ),
  defineRequirement('HOST-033', 'de5ad378011c738d', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-034', '3efabbe2ed0f6931', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement(
    'HOST-035',
    '31f8b801291b4176',
    'host',
    'not-applicable',
    'partialInput',
    'Athena accepts already-recovered partial argument objects; it does not parse partial JSON text.',
  ),
  defineRequirement(
    'HOST-036',
    'ea55b72598138f8a',
    'host',
    'not-applicable',
    'partialInput',
    'No producer currently streams recovered arguments into the host facade.',
  ),
  defineRequirement('HOST-037', '84733a41887e8c76', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-007', '7553d87ffe23b44e', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-008', '70b28eacd98143d7', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-009', '819da869a246b145', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-010', '0bb16720f40a7052', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-038', '2e68bda03f79138f', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-039', '0cdde0b95ffcfbfe', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-040', 'f015a38ba124b0eb', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-041', '1b64b788ca631e39', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-042', '76ea38b65b78d222', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-011', '046f65bc220ebdf4', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-043', '5c96e66e7e266461', 'host', 'applicable', 'officialLifecycle'),
  defineRequirement('VIEW-012', 'dfa0d4b6f2d785a8', 'view', 'applicable', 'officialLifecycle'),
  defineRequirement('HOST-044', 'e99bcd73b3fe0f30', 'host', 'applicable', 'clientCapability'),
  defineRequirement(
    'SERVER-011',
    '3763365bf9766368',
    'server',
    'not-applicable',
    'serverFallback',
    'Athena always registers meaningful text fallback and UI metadata remains ignorable by non-UI clients.',
  ),
  defineRequirement('SERVER-012', 'c8c4b25b5d3cdae9', 'server', 'applicable', 'serverFallback'),
  defineRequirement('SERVER-013', '0204cb2df93c1ff8', 'server', 'applicable', 'serverFallback'),
  defineRequirement(
    'SERVER-014',
    'bf69a1147461a1b4',
    'server',
    'not-applicable',
    'capabilityOmission',
    'Athena registers one tool variant with meaningful text fallback, not capability-specific variants.',
  ),
  defineRequirement('HOST-045', 'ec1020d755533a12', 'host', 'applicable', 'browserSandbox'),
  defineRequirement('HOST-046', '2c524d654b45131a', 'host', 'applicable', 'csp'),
  defineRequirement('HOST-047', 'd78fa78cbe09a04b', 'host', 'applicable', 'csp'),
  defineRequirement(
    'HOST-048',
    'c3b346520880adfe',
    'host',
    'not-applicable',
    'capabilityOmission',
    'Athena visibly contains apps in sandbox chrome and enforces declarations; it does not add a separate external-domain warning.',
  ),
  defineRequirement(
    'HOST-049',
    '565f888ad0f06eef',
    'host',
    'not-applicable',
    'capabilityOmission',
    'Athena uses exact per-resource declarations and has no global domain list feature.',
  ),
];

/** Advertised stable optional surfaces and the end-to-end test that proves each promise. */
export const ADVERTISED_OPTIONAL_CAPABILITIES = [
  { capability: 'openLinks', test: EVIDENCE.officialLifecycle.test },
  { capability: 'serverTools', test: EVIDENCE.officialLifecycle.test },
  { capability: 'message.text', test: EVIDENCE.officialLifecycle.test },
  { capability: 'sandbox.csp', test: EVIDENCE.browserSandbox.test },
  { capability: 'sandbox.permissions', test: EVIDENCE.browserSandbox.test },
  { capability: 'hostContext.theme', test: EVIDENCE.officialLifecycle.test },
  { capability: 'hostContext.sizing', test: EVIDENCE.officialLifecycle.test },
  { capability: 'displayMode.inline', test: EVIDENCE.officialLifecycle.test },
  { capability: 'displayMode.fullscreen', test: EVIDENCE.officialLifecycle.test },
] as const;

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Render the generated normative matrix committed under `docs/engineering/specs/`. */
export function renderConformanceMatrix(
  sources: SpecSources,
  requirements: readonly NormativeRequirement[] = NORMATIVE_REQUIREMENTS,
): string {
  const extension = sources.extensions['io.modelcontextprotocol/ui'];
  if (!extension) throw new Error('sources.json does not record the ui extension');
  const lines = [
    '<!-- GENERATED FILE. Regenerate with:',
    '     pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts -->',
    '',
    '# MCP Apps stable normative conformance manifest',
    '',
    `**Extension:** \`io.modelcontextprotocol/ui\``,
    `**Version:** \`${extension.version}\``,
    `**Source:** ${extension.landingPage}`,
    `**Spec copy:** \`docs/engineering/specs/vendor/${extension.specFile}\``,
    `**Spec SHA-256:** \`${sources.files[extension.specFile]?.sha256 ?? 'missing'}\``,
    `**Retrieved:** ${sources.retrievedAt}`,
    '',
    `This generated manifest accounts for all ${requirements.length} uppercase RFC 2119 occurrences`,
    'in the committed stable prose. `MAY` features are recorded but unsupported optional behavior',
    'remains unadvertised. Applicable rows name production code and a behavioral test; conditional',
    'or unsupported rows retain a concrete reason and omission evidence.',
    '',
  ];
  for (const role of ['host', 'sandbox', 'server', 'view'] as const) {
    lines.push(
      `## ${role[0]?.toUpperCase()}${role.slice(1)} requirements`,
      '',
      '| ID | Level | Source | Applicability | Implementation | Behavioral test | Reason |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const requirement of requirements.filter((item) => item.role === role)) {
      lines.push(
        `| \`${requirement.id}\` | **${requirement.level}** | ${escapeCell(requirement.sourceHeading)} L${requirement.sourceLine} \`${requirement.sourceFingerprint}\`<br>${escapeCell(requirement.sourceText)} | ${requirement.applicability} | \`${escapeCell(requirement.implementation)}\` | \`${escapeCell(requirement.test)}\` | ${escapeCell(requirement.reason ?? '')} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Advertised optional capability evidence',
    '',
    '| Capability | End-to-end test |',
    '| --- | --- |',
    ...ADVERTISED_OPTIONAL_CAPABILITIES.map(
      (entry) => `| \`${entry.capability}\` | \`${entry.test}\` |`,
    ),
    '',
  );
  return lines.join('\n');
}
