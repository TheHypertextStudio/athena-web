/**
 * `scripts/set-secret-from-clipboard.ts` — write the current clipboard contents into `.env.local`
 * under a given var name, so a copied credential never has to be hand-pasted into the file.
 *
 * @remarks
 * Reuses {@link upsertEnvVars} (`integrations-setup.ts`) — the same atomic, permission-locked
 * writer `pnpm integrations` already uses — so this stays a thin clipboard-to-writer bridge rather
 * than a second env-file implementation. The value itself is never printed or logged; only the var
 * name and a character count are.
 *
 * Usage: `pnpm secret:paste NOTION_CLIENT_SECRET`
 */
import { execFileSync } from 'node:child_process';

import { upsertEnvVars } from './integrations-setup';

const ENV_LOCAL_PATH = new URL('../.env.local', import.meta.url).pathname;

/** Clipboard-read commands to try, in order, until one succeeds. */
const PASTE_COMMANDS: readonly (readonly string[])[] = [
  ['pbpaste'],
  ['xclip', '-selection', 'clipboard', '-o'],
  ['wl-paste'],
  ['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard'],
];

/** Read the current clipboard contents, trying each platform's read command in turn. */
function readClipboard(): string {
  for (const [cmd, ...args] of PASTE_COMMANDS) {
    if (!cmd) continue;
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' });
    } catch {
      // try the next command
    }
  }
  throw new Error(
    'Could not read the clipboard (tried pbpaste, xclip, wl-paste, PowerShell Get-Clipboard).',
  );
}

function main(): void {
  const varName = process.argv[2];
  if (!varName || !/^[A-Z][A-Z0-9_]*$/.test(varName)) {
    console.error('Usage: pnpm secret:paste <ENV_VAR_NAME>');
    console.error('Example: pnpm secret:paste NOTION_CLIENT_SECRET');
    process.exit(1);
  }

  const value = readClipboard().trim();
  if (!value) {
    console.error('Clipboard is empty — copy the value first, then re-run.');
    process.exit(1);
  }

  upsertEnvVars(ENV_LOCAL_PATH, { [varName]: value });
  console.log(`Wrote ${varName} to .env.local (${value.length} chars). Value not printed.`);
}

main();
