#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const allowedScopes = new Set(
  readFileSync(new URL('../../COMMIT_SCOPES.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);

function deny(scope) {
  const reason = `Commit scope "${scope}" is not allowed. Use one of: ${[...allowedScopes].join(', ')}.`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny' },
      systemMessage: reason,
    }),
  );
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function commandFrom(input) {
  const command = input?.tool_input?.cmd ?? input?.tool_input?.command;
  if (Array.isArray(command)) return command.join(' ');
  return typeof command === 'string' ? command : '';
}

function commitSubject(command) {
  const messageFlag = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/.exec(
    command,
  );
  if (messageFlag) return messageFlag[1] ?? messageFlag[2] ?? messageFlag[3] ?? null;

  const heredoc =
    /(?:-F|--file)(?:=|\s+)-\s*<<-?\s*['"]?([A-Za-z0-9_]+)['"]?\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/.exec(
      command,
    );
  return heredoc?.[2]?.split(/\r?\n/, 1)[0] ?? null;
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const command = commandFrom(input);
if (!/(?:^|[;&|]\s*)git(?:\s+-C\s+\S+)?\s+commit(?:\s|$)/.test(command)) process.exit(0);

const subject = commitSubject(command);
if (!subject) process.exit(0);

const conventional = /^[a-z]+(?:\(([a-z][a-z0-9-]*)\))?!?:\s+/.exec(subject.trim());
const scope = conventional?.[1];
if (scope && !allowedScopes.has(scope)) deny(scope);
