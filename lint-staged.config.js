import path from 'node:path';

const BATCH_SIZE = 100;

function quotePath(path) {
  return `'${path.replaceAll("'", `'"'"'`)}'`;
}

function batch(command, files) {
  const commands = [];

  for (let offset = 0; offset < files.length; offset += BATCH_SIZE) {
    commands.push(
      `${command} ${files
        .slice(offset, offset + BATCH_SIZE)
        .map(quotePath)
        .join(' ')}`,
    );
  }

  return commands;
}

function workspaceKey(file) {
  const [scope, name] = path.relative(process.cwd(), file).split(path.sep);
  return ['apps', 'domains', 'packages', 'tooling'].includes(scope) ? `${scope}/${name}` : scope;
}

function batchByWorkspace(command, files) {
  const workspaces = Map.groupBy(files, workspaceKey);
  return [...workspaces.values()].flatMap((workspaceFiles) => batch(command, workspaceFiles));
}

export default {
  // `--no-warn-ignored`: the shared preset deliberately ignores `*.config.ts`, `*.config.js` and
  // `tooling/**` (they belong to no tsconfig, so the type-aware parser cannot resolve them). ESLint
  // reports each ignored file it was handed as a *warning*, and `--max-warnings=0` turns that into
  // a failed commit — so staging any config file blocked the commit with nothing actually wrong.
  '*.{ts,tsx}': (files) => [
    ...batch('prettier --write', files),
    ...batchByWorkspace(
      'node --max-old-space-size=4096 ./node_modules/eslint/bin/eslint.js --max-warnings=0 --no-warn-ignored',
      files,
    ),
  ],
  '*.{json,md,yaml,yml}': (files) => batch('prettier --write', files),
};
