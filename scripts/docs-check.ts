/** Validate the public Mintlify source without requiring Mintlify's 800-package local CLI. */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PRIMARY_ORIGIN = 'https://docket.hypertext.studio';

interface DocsConfig {
  readonly name?: string;
  readonly navigation?: unknown;
  readonly navbar?: { readonly primary?: { readonly href?: string } };
  readonly redirects?: readonly {
    readonly source?: string;
    readonly destination?: string;
  }[];
}

function addPageValue(value: unknown, pages: Set<string>): void {
  if (typeof value === 'string' && !value.includes('://')) {
    pages.add(value.replace(/^\//, ''));
    return;
  }
  collectPagePaths(value, pages);
}

function collectPagePaths(value: unknown, pages: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPagePaths(item, pages);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'pages' && Array.isArray(child)) {
      for (const page of child) addPageValue(page, pages);
    } else {
      collectPagePaths(child, pages);
    }
  }
}

function pagePaths(value: unknown): Set<string> {
  const pages = new Set<string>();
  collectPagePaths(value, pages);
  return pages;
}

function mdxFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return mdxFiles(root, path);
    return entry.isFile() && entry.name.endsWith('.mdx')
      ? [relative(root, path).split(sep).join('/')]
      : [];
  });
}

function frontmatter(source: string): { readonly title?: string; readonly description?: string } {
  const block = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  const field = (name: string): string | undefined => {
    const value = new RegExp(String.raw`^${name}:\s*['"]?(.+?)['"]?\s*$`, 'm')
      .exec(block)?.[1]
      ?.trim();
    return value === '' ? undefined : value;
  };
  return { title: field('title'), description: field('description') };
}

function headingSlugs(source: string): Set<string> {
  const slugs = new Set<string>();
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = (match[1] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function checkConfig(config: DocsConfig): string[] {
  const issues: string[] = [];
  if (config.name !== 'Docket') issues.push('docs.json must name the site Docket.');
  if (config.navbar?.primary?.href !== PRIMARY_ORIGIN) {
    issues.push(`docs.json primary action must open ${PRIMARY_ORIGIN}.`);
  }
  return issues;
}

function checkNavigation(configured: Set<string>, actualPages: Set<string>): string[] {
  const issues: string[] = [];
  for (const page of configured) {
    if (!actualPages.has(page)) {
      issues.push(`${page} is configured in navigation but has no MDX file.`);
    }
  }
  for (const page of actualPages) {
    if (!configured.has(page)) issues.push(`${page}.mdx is not present in navigation.`);
  }
  return issues;
}

function checkRedirects(config: DocsConfig, actualPages: Set<string>): string[] {
  const issues: string[] = [];
  const redirectSources = new Set<string>();
  for (const redirect of config.redirects ?? []) {
    const source = redirect.source?.replace(/^\//, '');
    const destination = redirect.destination?.replace(/^\//, '');
    if (!source || !destination) {
      issues.push('docs.json contains a redirect without a source and destination.');
      continue;
    }
    if (redirectSources.has(source)) issues.push(`docs.json repeats redirect source /${source}.`);
    redirectSources.add(source);
    if (actualPages.has(source)) issues.push(`docs.json redirect source still exists: /${source}.`);
    if (!actualPages.has(destination)) {
      issues.push(`docs.json redirect destination does not exist: /${destination}.`);
    }
  }
  return issues;
}

function checkTitle(
  page: string,
  title: string | undefined,
  titles: Map<string, string>,
): string[] {
  if (!title) return [`${page}.mdx needs a frontmatter title.`];
  const firstPage = titles.get(title);
  if (firstPage) return [`${page}.mdx has duplicate title "${title}" with ${firstPage}.mdx.`];
  titles.set(title, page);
  return [];
}

function checkLinks(page: string, source: string, sources: ReadonlyMap<string, string>): string[] {
  const issues: string[] = [];
  for (const match of source.matchAll(/(?:\]\(|href=["'])(\/[A-Za-z0-9_./#-]+)/g)) {
    const href = match[1] ?? '';
    const [path, anchor] = href.replace(/^\//, '').split('#');
    const target = path ? sources.get(path) : undefined;
    if (!path || target === undefined) {
      issues.push(`${page}.mdx has a broken local link: ${href}.`);
      continue;
    }
    if (anchor && !headingSlugs(target).has(anchor)) {
      issues.push(`${page}.mdx has a broken local anchor: ${href}.`);
    }
  }
  return issues;
}

function checkPage(
  page: string,
  source: string,
  sources: ReadonlyMap<string, string>,
  titles: Map<string, string>,
): string[] {
  const issues = checkTitle(page, frontmatter(source).title, titles);
  const description = frontmatter(source).description;
  if (!description || description.length < 30) {
    issues.push(`${page}.mdx description must explain the page in at least 30 characters.`);
  }
  if (/docket documentation demo|demo workspace/i.test(source)) {
    issues.push(`${page}.mdx contains forbidden demo copy.`);
  }
  issues.push(...checkLinks(page, source, sources));
  return issues;
}

/**
 * Check navigation coverage, frontmatter, links, anchors, canonical URLs, and fixture copy.
 *
 * @param root - Directory that contains Mintlify's `docs.json`.
 * @returns One actionable message per failed documentation invariant.
 */
export function checkDocs(root: string): string[] {
  const config = JSON.parse(readFileSync(resolve(root, 'docs.json'), 'utf8')) as DocsConfig;
  const configured = pagePaths(config.navigation);
  const files = mdxFiles(root);
  const actualPages = new Set(files.map((file) => file.replace(/\.mdx$/, '')));
  const sources = new Map(
    files.map((file) => [file.replace(/\.mdx$/, ''), readFileSync(resolve(root, file), 'utf8')]),
  );
  const titles = new Map<string, string>();
  return [
    ...checkConfig(config),
    ...checkNavigation(configured, actualPages),
    ...checkRedirects(config, actualPages),
    ...[...sources].flatMap(([page, source]) => checkPage(page, source, sources, titles)),
  ].sort();
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../apps/docs');
  const issues = checkDocs(root);
  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`docs: ${issue}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`docs: ${String(mdxFiles(root).length)} pages passed source checks\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
