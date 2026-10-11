import { isDeepStrictEqual } from 'node:util';

/**
 * Keep the configuration frozen before build identical to the retained artifact configuration.
 * @param source The checked-in TypeScript bundling configuration.
 * @param prebuilt The checked-in flat-module deployment configuration.
 * @throws When the source is invalid or any provider/packaging setting differs.
 */
export function assertWorkerArtifactConfig(source: unknown, prebuilt: unknown): void {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Workers source configuration must be an object');
  }
  const expected = {
    ...source,
    main: 'worker.js',
    no_bundle: true,
    find_additional_modules: true,
    base_dir: '.',
    rules: [
      { type: 'ESModule', globs: ['*.js', '*.mjs'], fallthrough: true },
      { type: 'CompiledWasm', globs: ['*.wasm'], fallthrough: true },
      { type: 'Data', globs: ['*.bin'], fallthrough: true },
    ],
  };
  if (!isDeepStrictEqual(prebuilt, expected)) {
    throw new Error('Prebuilt Workers configuration drifted from wrangler.jsonc');
  }
}
