import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';

/**
 * Atomically replace a file only when its bytes differ.
 *
 * @param path - Destination in the same directory as the temporary file.
 * @param content - Complete desired UTF-8 content.
 * @param defaultMode - Mode used for a newly created file; an existing mode is preserved.
 * @returns `true` when the destination changed.
 */
export function writeFileIfChanged(path: string, content: string, defaultMode = 0o600): boolean {
  const desired = Buffer.from(content, 'utf8');
  if (existsSync(path) && readFileSync(path).equals(desired)) return false;

  const mode = existsSync(path) ? statSync(path).mode & 0o777 : defaultMode;
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', mode);
    writeFileSync(descriptor, desired);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
    return true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
