import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('.', import.meta.url));
const publicIdentity = Object.freeze({
  NEXT_PUBLIC_APP_URL: 'https://clearthedocket.com',
  NEXT_PUBLIC_API_URL: 'https://api.clearthedocket.com',
  NEXT_PUBLIC_PASSKEY_RP_ID: 'clearthedocket.com',
  DOCS_MINTLIFY_ORIGIN: 'https://docket.mintlify.dev',
});
const forbiddenInputs = new Set([
  'SKIP_ENV_VALIDATION',
  'STUDIO_ENV_FILE',
  'DOCKET_LOCAL_ACCEPTANCE',
  'DOCKET_RUNTIME_TARGET',
  'DOCKET_WORKERS_BUILD',
  'API_URL',
  'WEB_URL',
  'STUDIO_DEPLOYMENT_ENV',
  'PUBLIC_BRIEF_HOST',
  'BETTER_AUTH_PASSKEY_RP_ID',
  'BETTER_AUTH_PASSKEY_LEGACY_RP_ID',
]);
const nextEnvFiles = ['.env', '.env.local', '.env.production', '.env.production.local'];

function assertBuildInputs() {
  for (const name of Object.keys(process.env)) {
    if (forbiddenInputs.has(name)) {
      throw new Error(`Shipping build rejects input ${name}.`);
    }
    if (name.startsWith('NEXT_PUBLIC_') && !Object.hasOwn(publicIdentity, name)) {
      throw new Error(`Shipping build rejects unexpected public input ${name}.`);
    }
  }
  for (const [name, expected] of Object.entries(publicIdentity)) {
    if (Object.hasOwn(process.env, name) && process.env[name] !== expected) {
      throw new Error(`Shipping build rejects conflicting input ${name}.`);
    }
  }
}

function assertNoNextEnvFiles() {
  for (const name of nextEnvFiles) {
    try {
      lstatSync(new URL(name, import.meta.url));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`Shipping build cannot inspect ${name}.`, { cause: error });
    }
    throw new Error(`Shipping build rejects app-local ${name}.`);
  }
}

try {
  assertBuildInputs();
  assertNoNextEnvFiles();
  // Validate before Turbo receives its strict environment or runs dependency builds.
  const result = spawnSync('pnpm', ['run', 'build:worker'], {
    cwd: appDirectory,
    env: { ...process.env, ...publicIdentity },
    stdio: 'inherit',
  });
  if (result.error || result.signal) {
    throw new Error('Shipping Worker build could not complete.');
  }
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Shipping build input validation failed.');
  process.exitCode = 1;
}
