/**
 * Policy: the published documentation site keeps up with the product it documents.
 *
 * @remarks
 * `docs/engineering/mcp-access.md` claimed 15 MCP tools while 25 were registered, and
 * `specs/mcp-surface.md` copied a similarly wrong number from it. So the four facts most likely to
 * drift are asserted: the MCP tools, the OAuth scopes, the vocabulary keys, and the `docs.json`
 * navigation.
 *
 * Read from source text rather than imported. The tool list has no importable form — registration
 * is identity-scoped — and `TOOL_SCOPE` covers only 22 of the 25, since `repeating-work-tools.ts`
 * enforces scope inline.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT, filesUnder } from '../workspace';

const DOCS_ROOT = resolve(WORKSPACE_ROOT, 'apps/docs');
const MCP_SOURCE_DIR = resolve(WORKSPACE_ROOT, 'apps/api/src/mcp');
// The declarations moved here when Work became its own domain; `packages/types/src/vocabulary.ts`
// is now a deprecated re-export shim with no literals in it to read.
const VOCABULARY_SOURCE = resolve(WORKSPACE_ROOT, 'domains/work/src/vocabulary.ts');
const OAUTH_SCOPE_SOURCE = resolve(WORKSPACE_ROOT, 'packages/types/src/oauth-scope.ts');

const MCP_REFERENCE_PAGE = 'developers/mcp-tools-and-resources.mdx';
const AUTHENTICATION_PAGE = 'developers/authentication.mdx';
const TERMINOLOGY_PAGE = 'guides/concepts/terminology.mdx';
const CONCEPTS_DIR = 'guides/concepts';

/**
 * Lower bounds that make a silent scan failure loud. A regex that stops matching returns an empty
 * set, which satisfies every "each of these appears in the docs" assertion vacuously.
 */
const MINIMUM_MCP_TOOLS = 20;
const MINIMUM_NAVIGATION_PAGES = 25;
const EXPECTED_CAPABILITY_SCOPES = 4;
const EXPECTED_VOCABULARY_KEYS = 6;

/**
 * The interim apex, assembled rather than written, so this file is not itself a hit.
 *
 * @see `packages/env/tests/hosts/legacy-host-policy.test.ts` for the ban this complements.
 */
const LEGACY_APEX = ['hypertext', 'studio'].join('.');

/**
 * Every published page allowed to name the interim apex, and how many times.
 *
 * @remarks
 * `legacy-host-policy.test.ts` bans this hostname but scans only each workspace's `src` tree, which
 * `apps/docs` does not have. A ban is wrong here, since a reader copying `claude mcp add` needs a
 * URL that answers. So this is a ratchet: it may shrink, never grow. Counted per file, so a URL
 * moving between pages cannot hide under an unchanged total.
 *
 * Mintlify `docs.json` variables retire part of this. Verified against `mint dev`: `{{camelCase}}`
 * substitutes in prose, inline code, and fenced code blocks, and names must be camelCase because a
 * hyphen makes MDX parse `{{a-b}}` as a JS expression and fail the page. It does NOT substitute in
 * a markdown link destination, which renders the braces URL-encoded, and `docs.json` cannot
 * reference its own variables. That leaves the 14 hits in `rest-api.mdx` (link destinations) and
 * the 8 in `docs.json`.
 */
const LEGACY_APEX_INVENTORY: Readonly<Record<string, number>> = {
  'developers/connect-an-agent-mcp.mdx': 5,
  'developers/errors.mdx': 2,
  'developers/rest-api.mdx': 14,
  'docs.json': 8,
};

function readDocsFile(relativePath: string): string {
  return readFileSync(resolve(DOCS_ROOT, relativePath), 'utf8');
}

/** Every published file, relative to `apps/docs`, that could carry a hostname. */
function publishedDocsFiles(): string[] {
  return filesUnder(DOCS_ROOT, ['.mdx', '.json']).map((file) => relative(DOCS_ROOT, file));
}

/** Every `.ts` file under the MCP server directory, read as one blob. */
function readMcpSources(): string {
  return filesUnder(MCP_SOURCE_DIR, ['.ts'])
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

/**
 * Tool names taken from the `registerTool` / `registerOptionalTaskTool` call sites.
 *
 * The optional identifier group absorbs `registerOptionalTaskTool(server, 'name', …)`, whose
 * first argument is the server rather than the name. Generic declarations in `catalog.ts` and
 * the internal `this.mcp.registerTool(name, …)` forwarder pass an identifier where this wants a
 * string literal, so neither matches.
 */
function registeredMcpToolNames(): string[] {
  const pattern = /register(?:OptionalTask)?Tool\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?'([a-z_]+)'/g;
  const names = new Set<string>();
  for (const match of readMcpSources().matchAll(pattern)) {
    const [, name] = match;
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/** The union members of a `export type X = 'a' | 'b';` declaration. */
function unionMembers(source: string, typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName} =([^;]+);`).exec(source);
  if (declaration === null) return [];
  const [, body] = declaration;
  return [...(body ?? '').matchAll(/'([^']+)'/g)].map(([, member]) => member ?? '');
}

/**
 * Every page path in the `docs.json` navigation tree.
 *
 * @remarks
 * Only strings under a `pages` key count. Tab, group, and anchor titles are strings too, and
 * collecting them would assert that a file named `Core concepts.mdx` exists.
 */
function navigationPages(node: unknown, insidePages = false): string[] {
  if (typeof node === 'string') return insidePages ? [node] : [];
  if (Array.isArray(node))
    return node.flatMap((child): string[] => navigationPages(child, insidePages));
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]): string[] =>
    navigationPages(value, key === 'pages'),
  );
}

describe('documentation site coverage', () => {
  it('every page docs.json navigates to exists on disk', () => {
    const config: unknown = JSON.parse(readDocsFile('docs.json'));
    const navigation =
      typeof config === 'object' && config !== null && 'navigation' in config
        ? config.navigation
        : null;

    const pages = navigationPages(navigation);
    expect(pages.length).toBeGreaterThanOrEqual(MINIMUM_NAVIGATION_PAGES);

    const missing = pages.filter((page) => !existsSync(resolve(DOCS_ROOT, `${page}.mdx`)));
    expect(missing, `\nNavigation entries with no .mdx file:\n  ${missing.join('\n  ')}\n`).toEqual(
      [],
    );
  });

  it('every registered MCP tool is named in the MCP reference page', () => {
    const tools = registeredMcpToolNames();
    expect(tools.length).toBeGreaterThanOrEqual(MINIMUM_MCP_TOOLS);

    const page = readDocsFile(MCP_REFERENCE_PAGE);
    const undocumented = tools.filter((tool) => !page.includes(`\`${tool}\``));
    expect(
      undocumented,
      `\nMCP tools registered in apps/api/src/mcp but absent from apps/docs/${MCP_REFERENCE_PAGE}:\n  ${undocumented.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('every OAuth capability scope is documented on both pages that promise a full list', () => {
    const scopes = unionMembers(readFileSync(OAUTH_SCOPE_SOURCE, 'utf8'), 'McpCapabilityScope');
    expect(scopes).toHaveLength(EXPECTED_CAPABILITY_SCOPES);

    for (const page of [AUTHENTICATION_PAGE, MCP_REFERENCE_PAGE]) {
      const content = readDocsFile(page);
      const undocumented = scopes.filter((scope) => !content.includes(`\`${scope}\``));
      expect(
        undocumented,
        `\nOAuth scopes absent from apps/docs/${page}:\n  ${undocumented.join('\n  ')}\n`,
      ).toEqual([]);
    }
  });

  it('names the interim apex only where the pinned inventory says it may', () => {
    const counted = new Map<string, number>();
    for (const file of publishedDocsFiles()) {
      const hits = readDocsFile(file).split(LEGACY_APEX).length - 1;
      if (hits > 0) counted.set(file, hits);
    }

    const expected = Object.entries(LEGACY_APEX_INVENTORY).sort();
    const actual = [...counted].sort();
    expect(
      actual,
      "\nThe published docs' use of the interim apex changed. It may shrink — delete entries as" +
        '\npages stop naming it. It may not grow. See docs/engineering/domain-cutover.md.\n',
    ).toEqual(expected);
  });

  it('every vocabulary key is translated and then explained', () => {
    const source = readFileSync(VOCABULARY_SOURCE, 'utf8');
    const keys = unionMembers(source, 'VocabularyKey');
    expect(keys).toHaveLength(EXPECTED_VOCABULARY_KEYS);

    // `presetStartup` alone — the nonprofit and agency presets are formatted identically and would
    // otherwise overwrite it. Bounded by the literal's closing brace, so preset order is free.
    const startupPreset =
      /export const presetStartup[^{]*\{([\s\S]*?)^\};/m.exec(source)?.[1] ?? '';
    const defaults = new Map(
      [...startupPreset.matchAll(/([a-z]+): \{ singular: '([^']+)'/g)].map(
        ([, key, singular]) => [key ?? '', singular ?? ''] as const,
      ),
    );
    expect(defaults.size, 'presetStartup no longer parses out of vocabulary.ts').toBe(
      EXPECTED_VOCABULARY_KEYS,
    );

    const conceptPages = readdirSync(resolve(DOCS_ROOT, CONCEPTS_DIR))
      .filter((name) => name.endsWith('.mdx') && name !== 'terminology.mdx')
      .map((name) => readFileSync(resolve(DOCS_ROOT, CONCEPTS_DIR, name), 'utf8'))
      .join('\n');
    const terminology = readDocsFile(TERMINOLOGY_PAGE);

    const untranslated = keys.filter((key) => !terminology.includes(defaults.get(key) ?? key));
    expect(
      untranslated,
      `\nVocabulary keys missing from apps/docs/${TERMINOLOGY_PAGE}:\n  ${untranslated.join('\n  ')}\n`,
    ).toEqual([]);

    const unexplained = keys.filter((key) => !conceptPages.includes(defaults.get(key) ?? key));
    expect(
      unexplained,
      `\nVocabulary keys with no concept page under apps/docs/${CONCEPTS_DIR}:\n  ${unexplained.join('\n  ')}\n`,
    ).toEqual([]);
  });
});
