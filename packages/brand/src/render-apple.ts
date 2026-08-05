/**
 * `pnpm --filter @docket/brand icons:apple` — export the Apple icon set from
 * `apps/web/design/Docket.icon` using Apple's own Icon Composer renderer.
 *
 * @remarks
 * **This script renders nothing itself.** It shells out to `ictool`, the command-line exporter
 * that ships inside `Icon Composer.app` (Xcode 26), and that tool is what rasterizes the committed
 * `.icon` document. The Liquid Glass treatment — the specular edge highlight on each bar, the
 * refraction-tinted shadow, the platform mask, the per-appearance materials — is produced by
 * Apple's `IconRendering` framework, not by anything in this repository. There is no way to
 * reproduce it with `sharp`, which is precisely why the source of truth for the Apple assets is a
 * `.icon` document rather than the flat SVG the other icons are rendered from. The layer inside
 * that document is written by {@link file://./render-apple-layer.ts}, kept separate so this file
 * can contain no artwork generation at all.
 *
 * **Why the Apple set is generated separately from `render-pwa.ts`.** The two must not share a
 * source or an output directory. `render-pwa.ts` owns `public/icons/*` — the manifest's `any` and
 * `maskable` entries, which Android and Chrome read — and this script owns
 * `src/app/apple-icon<n>.png`, which only Safari reads. Keeping them apart is what makes "adding
 * the Apple icons must not alter icons on other platforms" true by construction: neither script
 * can write the other's files, and the manifest names no Apple asset at all.
 *
 * **The outputs are committed, not built on demand.** `ictool` exists only on a Mac with Xcode 26
 * installed; the production build runs in a Linux container. Committing the PNGs keeps the artwork
 * reviewable in a diff and keeps installability independent of the build host.
 *
 * @see {@link file://../../../apps/web/design/Docket.icon/icon.json} — the Icon Composer source.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import sharp from 'sharp';

import { APPLE_ICONS, type AppleIconExport } from './apple-icons';
import { ICON_DOCUMENT, REPO_ROOT } from './paths';

const execFileAsync = promisify(execFile);

/**
 * The Icon Composer command-line exporter.
 *
 * @remarks
 * Lives inside the app bundle rather than on `PATH`: `xcrun --find icon-composer` does not resolve
 * it, so the bundle path is the only reliable way to reach it. Absent this binary the script
 * refuses to run rather than silently falling back to a hand-rolled render — a fallback would
 * quietly replace an Apple-rendered asset with an approximation of one.
 */
const ICTOOL =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';

/** Whether Icon Composer's exporter is present on this machine. */
export async function ictoolAvailable(): Promise<boolean> {
  try {
    await access(ICTOOL);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export one asset by invoking Icon Composer's renderer.
 *
 * @remarks
 * `ictool` writes 16-bit-per-channel RGBA, which costs roughly eight times the bytes of the 8-bit
 * image every browser and every Apple platform actually displays. The second pass re-encodes those
 * exact pixels at 8 bits and nothing else: no resize, no recolour, no compositing, no mask. The
 * artwork is still Icon Composer's render; only the container is normalized.
 *
 * @param spec - What to render and where to put it.
 * @returns The byte length committed.
 */
async function exportIcon(spec: AppleIconExport): Promise<number> {
  await mkdir(dirname(spec.outPath), { recursive: true });
  await execFileAsync(ICTOOL, [
    ICON_DOCUMENT,
    '--export-image',
    '--output-file',
    spec.outPath,
    '--platform',
    spec.platform,
    '--rendition',
    spec.rendition,
    '--width',
    String(spec.size),
    '--height',
    String(spec.size),
    '--scale',
    '1',
  ]);
  const normalized = await sharp(spec.outPath).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(spec.outPath, normalized);
  return normalized.byteLength;
}

async function main(): Promise<void> {
  if (!(await ictoolAvailable())) {
    process.stderr.write(
      'Icon Composer is not installed on this machine, so the Apple icons cannot be re-exported.\n' +
        'Install Xcode 26 or newer and run this script again. The committed PNGs are unchanged.\n',
    );
    process.exitCode = 1;
    return;
  }
  for (const spec of APPLE_ICONS) {
    const bytes = await exportIcon(spec);
    process.stdout.write(
      `${relative(REPO_ROOT, spec.outPath)} — ${String(spec.size)}px, ${spec.platform}, ${spec.rendition}, ${String(bytes)} bytes\n`,
    );
  }
}

await main();
