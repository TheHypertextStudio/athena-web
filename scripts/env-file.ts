import { readFileSync } from 'node:fs';

/**
 * Reading `.env` files, in one place.
 *
 * @remarks
 * Three scripts each carried their own copy of this parser, two of them byte-identical, each
 * commented "no dependency". The dependency-free part is worth keeping — a repository-maintenance
 * script should not need the workspace installed to tell an operator which variable is missing —
 * but one implementation can be dependency-free just as easily as three.
 *
 * The grammar is deliberately small: `KEY=VALUE` a line at a time, `#` comments, surrounding
 * quotes removed only when they match at both ends. It is not a shell parser and does not expand
 * anything; `.env.local` values reach the process exactly as they were written.
 */

/**
 * Parse a `.env` file into a plain record.
 *
 * @param path - Absolute path to the file. A missing file yields an empty record, because every
 * caller treats "no `.env.local` here" as a normal state rather than an error.
 * @returns Every declared key, including ones whose value is empty.
 */
export function parseEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    const value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    values[key] = quoted ? value.slice(1, -1) : value;
  }
  return values;
}

/**
 * Apply a `.env` file to `process.env` without overwriting what is already set.
 *
 * @remarks
 * A value already in the environment wins, so an operator can override one variable for a single
 * command without editing the file.
 *
 * @param path - Absolute path to the file; a missing file is a no-op.
 */
export function loadEnvFile(path: string): void {
  for (const [key, value] of Object.entries(parseEnvFile(path))) {
    process.env[key] ??= value;
  }
}
