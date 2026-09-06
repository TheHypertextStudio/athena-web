/**
 * `pnpm --filter @docket/brand icons:embedded` — write the mark into a TypeScript module, as
 * base64, so a bundled server can serve it.
 *
 * @remarks
 * The API is bundled to a single `dist/server.mjs` and its image copies no static directory, so an
 * icon it serves has to be in its source graph.
 *
 * It reads the PNGs `render-pwa.ts` committed rather than re-rendering them, so the icon the API
 * serves and the icon Android installs are the same bytes. That is why it runs last in the `icons`
 * chain. The `.ico` is the one asset it draws, because nothing else draws one — and writing it here
 * rather than in `render-web.ts` is what makes the file the web app serves and the bytes the API
 * serves one object.
 *
 * @see {@link file://../../../apps/api/src/routes/brand-icons.ts} which serves the result.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { markIco } from './ico';
import { EMBEDDED_ICONS, PWA_ICONS_DIR, WEB_FAVICON } from './paths';

/** What the generated module declares, and where each payload comes from. */
const EMBEDDED = [
  {
    constant: 'MARK_192_PNG_BASE64',
    doc: 'The mark at 192px, as PNG.',
    file: join(PWA_ICONS_DIR, 'icon-192.png'),
  },
  {
    constant: 'MARK_512_PNG_BASE64',
    doc: 'The mark at 512px, as PNG.',
    file: join(PWA_ICONS_DIR, 'icon-512.png'),
  },
  {
    constant: 'MARK_ICO_BASE64',
    doc: 'The mark at 16, 32 and 48px in one container.',
    file: WEB_FAVICON,
  },
] as const;

/**
 * Render the module's text.
 *
 * @param entries - Each constant's name, documentation, and base64 payload.
 * @returns The complete TypeScript source.
 */
function moduleText(entries: readonly { constant: string; doc: string; base64: string }[]): string {
  const declarations = entries
    .map(({ constant, doc, base64 }) => `/** ${doc} */\nexport const ${constant} = '${base64}';\n`)
    .join('\n');

  return `/**
 * The Docket mark as bytes, for a runtime that cannot read a file.
 *
 * @remarks
 * GENERATED — run \`pnpm --filter @docket/brand icons:embedded\` rather than editing this.
 * \`tests/embedded-icons.test.ts\` fails when these drift from the icon files they encode.
 */
${declarations}`;
}

async function main(): Promise<void> {
  await writeFile(WEB_FAVICON, await markIco());
  process.stdout.write('apps/web/src/app/favicon.ico\n');

  const entries = await Promise.all(
    EMBEDDED.map(async ({ constant, doc, file }) => ({
      constant,
      doc,
      base64: (await readFile(file)).toString('base64'),
    })),
  );

  await writeFile(EMBEDDED_ICONS, moduleText(entries));
  const bytes = entries.reduce((total, entry) => total + entry.base64.length, 0);
  process.stdout.write(
    `packages/brand/src/embedded-icons.generated.ts — ${String(entries.length)} icons, ${String(bytes)} base64 characters\n`,
  );
}

await main();
