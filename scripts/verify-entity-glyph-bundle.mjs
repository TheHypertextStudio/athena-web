/** Verify the production bundle boundaries for the shared entity glyph picker. */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const applicationRoot = resolve(repositoryRoot, process.argv[2] ?? 'apps/web');
const buildRoot = join(applicationRoot, '.next');
const maximumFontBytes = 750 * 1024;

const initialFiles = new Set();
const manifestFiles = [
  join(buildRoot, 'build-manifest.json'),
  ...(await listFiles(join(buildRoot, 'server', 'app'), 'build-manifest.json')),
];
for (const manifestFile of manifestFiles) {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  collectStrings(manifest, initialFiles);
}

const chunkRoot = join(buildRoot, 'static', 'chunks');
const chunkFiles = await listFiles(chunkRoot, '.js');
const emojiChunks = [];
for (const chunkFile of chunkFiles) {
  const source = await readFile(chunkFile, 'utf8');
  if (source.includes('grinning face') && source.includes('thumbs up')) {
    emojiChunks.push(relative(buildRoot, chunkFile));
  }
}
if (emojiChunks.length === 0) {
  throw new Error('The production build did not emit a recognizable lazy emoji-data chunk.');
}
const eagerEmojiChunks = emojiChunks.filter((chunk) => initialFiles.has(chunk));
if (eagerEmojiChunks.length > 0) {
  throw new Error(`Emoji data entered an initial route chunk: ${eagerEmojiChunks.join(', ')}`);
}

const uiRequire = createRequire(join(repositoryRoot, 'packages', 'ui', 'package.json'));
const roundedCss = uiRequire.resolve('@material-symbols/font-400/rounded.css');
const roundedFont = resolve(dirname(roundedCss), 'material-symbols-rounded.woff2');
const roundedFontBytes = (await stat(roundedFont)).size;
if (roundedFontBytes > maximumFontBytes) {
  throw new Error(
    `Material Symbols Rounded is ${roundedFontBytes} bytes, above the ${maximumFontBytes}-byte limit.`,
  );
}
const sourceHash = await hashFile(roundedFont);
const mediaFiles = await listFiles(join(buildRoot, 'static', 'media'), '.woff2');
const emittedFont = await findFileByHash(mediaFiles, sourceHash);
if (!emittedFont) {
  throw new Error('The production build did not emit the pinned Material Symbols Rounded font.');
}

process.stdout.write(
  `${JSON.stringify(
    {
      emojiChunks,
      eagerEmojiChunks,
      roundedFont: relative(buildRoot, emittedFont),
      roundedFontBytes,
    },
    null,
    2,
  )}\n`,
);

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
}

async function listFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, suffix)));
    else if (entry.name.endsWith(suffix)) files.push(path);
  }
  return files;
}

async function hashFile(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function findFileByHash(paths, expectedHash) {
  for (const path of paths) {
    if ((await hashFile(path)) === expectedHash) return path;
  }
  return null;
}
