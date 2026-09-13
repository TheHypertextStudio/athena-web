import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

/**
 * Turn what the user provides for Apple's Sign-in key — a path to the downloaded `.p8`, or pasted
 * PEM text — into the single-line, `\n`-escaped form `APPLE_PRIVATE_KEY` stores. Unlike GitHub's
 * key (base64), Apple's is stored with literal `\n` escapes so `generateAppleClientSecret` can
 * un-escape and parse it directly. An already-escaped value passes through unchanged (idempotent).
 *
 * @param raw - What the user typed: a file path, PEM text, or an existing escaped value.
 * @returns the single-line, `\n`-escaped PEM (or the input unchanged when already escaped).
 */
export function encodeApplePrivateKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('-----BEGIN')) {
    return trimmed.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
  }
  try {
    const path = trimmed.startsWith('~/')
      ? resolve(process.env['HOME'] ?? '', trimmed.slice(2))
      : trimmed;
    const fromFile = readFileSync(path, 'utf8');
    if (!fromFile.includes('-----BEGIN')) return trimmed;
    return fromFile.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
  } catch {
    return trimmed;
  }
}
